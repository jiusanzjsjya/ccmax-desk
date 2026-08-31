import { NextResponse } from "next/server";

import { canUploadKey, effectiveTargetBackend, getAccessContext, provisioningAccess } from "@/lib/access";
import { listOwnedAccountIds } from "@/lib/account-store";
import { resolveOpenAIConfig } from "@/lib/backends/registry";
import {
  fetchPoolUsage,
  listPoolAccounts,
  mapSub2ApiError,
  Sub2ApiError,
  type PoolAccount,
  type PoolUsage,
  type Sub2ApiRequestConfig,
} from "@/lib/sub2api";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;
const MAX_PAGES = 10; // bounded scan — mirrors the pool capacity (1000)

/**
 * Key 使用额度: real-time usage + dead-status for OpenAI api-key accounts on the
 * caller's assigned platform (primary Sub2API or a password-auth Sub2API 网关),
 * scoped to what the caller may see — superadmin sees every OpenAI key on that
 * instance, an admin/user only the ones they uploaded. Only usage (cost +
 * requests) and dead-ness are reported. Bound to the 授权上key grant.
 */
export async function GET() {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const access = provisioningAccess(context);
  if (!access.allowed) return NextResponse.json({ error: access.error }, { status: access.status });

  if (!canUploadKey(context)) return NextResponse.json({ error: "module_forbidden" }, { status: 403 });

  const ref = context.role === "superadmin" ? "sub2api" : effectiveTargetBackend(context);
  if (!ref) return NextResponse.json({ items: [], scoped: true });

  let config: Sub2ApiRequestConfig;
  try {
    config = await resolveOpenAIConfig(ref);
  } catch (error) {
    const failure = mapSub2ApiError(error, "目标平台不可用");
    if (!(error instanceof Sub2ApiError)) {
      console.error("[provisioning.openai.usage] target resolve failed", error instanceof Error ? error.message : error);
    }
    return NextResponse.json(failure.body, { status: failure.status });
  }

  // Non-superadmin: restrict to keys this caller uploaded to this platform.
  const owned = context.role === "superadmin" ? null : await listOwnedAccountIds(ref, context.session.userId);
  if (owned && owned.size === 0) {
    return NextResponse.json({ items: [], scoped: true });
  }

  try {
    const accounts = await collectOpenAIAccounts(owned, config);
    const ids = accounts.map((account) => Number(account.id)).filter((id) => Number.isFinite(id) && id > 0);
    const usageById: Record<string, PoolUsage> = ids.length ? await fetchPoolUsage(ids, config).catch(() => ({})) : {};

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

/** Bounded page-scan of the OpenAI pool on `config`; when `owned` is set, keep only those ids. */
async function collectOpenAIAccounts(owned: Set<string> | null, config: Sub2ApiRequestConfig): Promise<PoolAccount[]> {
  const collected: PoolAccount[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { items } = await listPoolAccounts(
      { page, pageSize: PAGE_SIZE, platform: "openai", sortBy: "created_at", sortOrder: "desc" },
      config,
    );
    if (!items.length) break;

    for (const account of items) {
      if (!owned || (account.id != null && owned.has(String(account.id)))) collected.push(account);
    }

    if (owned && collected.length >= owned.size) break; // found them all
    if (items.length < PAGE_SIZE) break; // last page
  }
  return collected;
}
