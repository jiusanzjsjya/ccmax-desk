import { NextResponse } from "next/server";

import { accountPoolAccess, getAccessContext } from "@/lib/access";
import { isSub2ApiConfigured } from "@/lib/backend-config";
import {
  fetchPoolUsage,
  getDashboardStats,
  listGroups,
  listPoolAccounts,
  mapSub2ApiError,
  Sub2ApiError,
  type PoolUsage,
} from "@/lib/sub2api";

export const dynamic = "force-dynamic";

/** Operator-set ceiling for how many accounts the pool is meant to carry. */
const POOL_CAPACITY = 1000;

/**
 * Pool-review data: a rich Sub2API account page plus the aggregate strip.
 * Sub2API-specific — the other backends don't expose this shape. No secrets
 * ever leave the server (listPoolAccounts already drops credentials).
 */
export async function GET(request: Request) {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!accountPoolAccess(context)) return NextResponse.json({ error: "account_pool_forbidden" }, { status: 403 });
  if (!(await isSub2ApiConfigured())) return NextResponse.json({ error: "sub2api_not_configured" }, { status: 503 });

  const params = new URL(request.url).searchParams;
  const page = clampInt(params.get("page"), 1, 1, 100000);
  const pageSize = clampInt(params.get("page_size"), 20, 1, 100);
  const search = (params.get("search") || "").slice(0, 100);
  const group = (params.get("group") || "").slice(0, 40);
  const status = (params.get("status") || "").slice(0, 20);
  const sortBy = (params.get("sort_by") || "created_at").slice(0, 40);
  const sortOrder = params.get("sort_order") === "asc" ? "asc" : "desc";
  // Groups change rarely — the client asks for them once, not on every refresh.
  const withGroups = params.get("with_groups") === "1";

  try {
    // Accounts are the payload; stats/groups are best-effort (may be gated).
    const [accounts, stats, groups] = await Promise.all([
      listPoolAccounts({ page, pageSize, search, group, status, sortBy, sortOrder }),
      getDashboardStats().catch(() => null),
      withGroups ? listGroups().catch(() => []) : Promise.resolve(null),
    ]);

    // Enrich this page with per-account cost/usage windows (best-effort).
    const ids = accounts.items
      .map((account) => Number(account.id))
      .filter((id) => Number.isFinite(id) && id > 0);
    const usageById: Record<string, PoolUsage> = ids.length ? await fetchPoolUsage(ids).catch(() => ({})) : {};
    const items = accounts.items.map((account) => ({ ...account, usage: usageById[String(account.id)] ?? null }));

    return NextResponse.json({ accounts: { items, total: accounts.total }, stats, groups, capacity: POOL_CAPACITY });
  } catch (error) {
    const failure = mapSub2ApiError(error, "读取账号池失败");
    if (!(error instanceof Sub2ApiError)) {
      console.error("[provisioning.pool] failed", error instanceof Error ? error.message : error);
    }
    return NextResponse.json(failure.body, { status: failure.status });
  }
}

function clampInt(raw: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}
