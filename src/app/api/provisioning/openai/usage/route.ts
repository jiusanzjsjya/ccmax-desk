import { NextResponse } from "next/server";

import { canUploadKey, getAccessContext, provisioningAccess } from "@/lib/access";
import { listOwnedAccountIds } from "@/lib/account-store";
import { isSub2ApiConfigured } from "@/lib/backend-config";
import { fetchPoolUsage, listPoolAccounts, mapSub2ApiError, Sub2ApiError, type PoolAccount, type PoolUsage } from "@/lib/sub2api";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;
const MAX_PAGES = 10; // bounded scan — mirrors the pool capacity (1000)

/**
 * Key 使用额度: real-time usage + dead-status for OpenAI api-key accounts, scoped
 * to what the caller may see — superadmin sees every OpenAI key, an admin/user
 * only the ones they uploaded (per the local ownership map). Only two things are
 * reported per key: usage (cost + requests) and whether it looks dead. Bound to
 * the 授权上key grant (canUploadKey).
 */
export async function GET() {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const access = provisioningAccess(context);
  if (!access.allowed) return NextResponse.json({ error: access.error }, { status: access.status });

  if (!canUploadKey(context)) return NextResponse.json({ error: "module_forbidden" }, { status: 403 });

  if (!(await isSub2ApiConfigured())) {
    return NextResponse.json({ error: "provisioning_not_configured" }, { status: 503 });
  }

  // Non-superadmin: restrict to keys this caller uploaded (ownership recorded
  // under the "sub2api" platform by the upload route). Empty set → nothing.
  const owned = context.role === "superadmin" ? null : await listOwnedAccountIds("sub2api", context.session.userId);
  if (owned && owned.size === 0) {
    return NextResponse.json({ items: [], scoped: true });
  }

  try {
    const accounts = await collectOpenAIAccounts(owned);
    const ids = accounts.map((account) => Number(account.id)).filter((id) => Number.isFinite(id) && id > 0);
    const usageById: Record<string, PoolUsage> = ids.length ? await fetchPoolUsage(ids).catch(() => ({})) : {};

    const items = accounts.map((account) => {
      const alive = account.status === "active" && account.schedulable !== false && !account.errorMessage;
      const usage = usageById[String(account.id)] ?? null;
      return {
        id: account.id,
        name: account.name,
        alive,
        deadReason: alive ? null : account.errorMessage || account.status || "unschedulable",
        todayCost: usage?.today?.cost ?? 0,
        todayRequests: usage?.today?.requests ?? 0,
        monthCost: usage?.thirtyDay?.cost ?? null,
      };
    });

    return NextResponse.json({ items, scoped: Boolean(owned) });
  } catch (error) {
    const failure = mapSub2ApiError(error, "读取 Key 使用额度失败");
    if (!(error instanceof Sub2ApiError)) {
      console.error("[provisioning.openai.usage] failed", error instanceof Error ? error.message : error);
    }
    return NextResponse.json(failure.body, { status: failure.status });
  }
}

/** Bounded page-scan of the OpenAI pool; when `owned` is set, keep only those ids. */
async function collectOpenAIAccounts(owned: Set<string> | null): Promise<PoolAccount[]> {
  const collected: PoolAccount[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { items } = await listPoolAccounts({
      page,
      pageSize: PAGE_SIZE,
      platform: "openai",
      sortBy: "created_at",
      sortOrder: "desc",
    });
    if (!items.length) break;

    for (const account of items) {
      if (!owned || (account.id != null && owned.has(String(account.id)))) collected.push(account);
    }

    if (owned && collected.length >= owned.size) break; // found them all
    if (items.length < PAGE_SIZE) break; // last page
  }
  return collected;
}
