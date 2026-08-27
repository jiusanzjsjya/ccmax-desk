import { NextResponse } from "next/server";

import { accountPoolAccess, getAccessContext, poolScope } from "@/lib/access";
import { listOwnedAccountIds } from "@/lib/account-store";
import { isSub2ApiConfigured } from "@/lib/backend-config";
import { refKind } from "@/lib/backends/kinds";
import { applyPoolQuery, collectOwnedAccounts, ownedStats } from "@/lib/pool-scope";
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
 *
 * Two orthogonal dimensions:
 * - platform: which backend's pool. Only `sub2api` has real data today; other
 *   platforms (custom gateways) return `{ pending: true }` until their account
 *   API lands.
 * - owner scoping: a regular `user` sees ONLY the accounts they onboarded
 *   (per-owner isolation), computed from the local ownership map.
 */
export async function GET(request: Request) {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!accountPoolAccess(context)) return NextResponse.json({ error: "account_pool_forbidden" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const platform = (params.get("platform") || "sub2api").slice(0, 80);
  // Non-Sub2API platforms have no browsable pool yet — placeholder, checked
  // before Sub2API config so selecting a gateway never 503s on Sub2API setup.
  if (refKind(platform) !== "sub2api") {
    return NextResponse.json({ pending: true, platform });
  }

  if (!(await isSub2ApiConfigured())) return NextResponse.json({ error: "sub2api_not_configured" }, { status: 503 });

  const page = clampInt(params.get("page"), 1, 1, 100000);
  const pageSize = clampInt(params.get("page_size"), 20, 1, 100);
  const search = (params.get("search") || "").slice(0, 100);
  const group = (params.get("group") || "").slice(0, 40);
  const status = (params.get("status") || "").slice(0, 20);
  const sortBy = (params.get("sort_by") || "created_at").slice(0, 40);
  const sortOrder = params.get("sort_order") === "asc" ? "asc" : "desc";
  // Groups change rarely — the client asks for them once, not on every refresh.
  const withGroups = params.get("with_groups") === "1";

  const scope = poolScope(context);

  try {
    if (scope.scoped) {
      return NextResponse.json(await scopedPool(platform, scope.ownerId!, { page, pageSize, search, status, sortBy, sortOrder }));
    }

    // Privileged (admin/superadmin): full pool, server pagination + global stats.
    const [accounts, stats, groups] = await Promise.all([
      listPoolAccounts({ page, pageSize, search, group, status, sortBy, sortOrder }),
      getDashboardStats().catch(() => null),
      withGroups ? listGroups().catch(() => []) : Promise.resolve(null),
    ]);

    const ids = accounts.items.map((account) => Number(account.id)).filter((id) => Number.isFinite(id) && id > 0);
    const usageById: Record<string, PoolUsage> = ids.length ? await fetchPoolUsage(ids).catch(() => ({})) : {};
    const items = accounts.items.map((account) => ({ ...account, usage: usageById[String(account.id)] ?? null }));

    return NextResponse.json({ accounts: { items, total: accounts.total }, stats, groups, capacity: POOL_CAPACITY, scoped: false });
  } catch (error) {
    const failure = mapSub2ApiError(error, "读取账号池失败");
    if (!(error instanceof Sub2ApiError)) {
      console.error("[provisioning.pool] failed", error instanceof Error ? error.message : error);
    }
    return NextResponse.json(failure.body, { status: failure.status });
  }
}

/** Owner-scoped pool: only the caller's own accounts, all computed in memory. */
async function scopedPool(
  platform: string,
  ownerId: string,
  query: { page: number; pageSize: number; search: string; status: string; sortBy: string; sortOrder: string },
) {
  const owned = await listOwnedAccountIds(platform, ownerId);
  if (owned.size === 0) {
    return { accounts: { items: [], total: 0 }, stats: ownedStats([]), groups: null, capacity: POOL_CAPACITY, scoped: true };
  }

  const all = await collectOwnedAccounts(owned);
  const allIds = all.map((account) => Number(account.id)).filter((id) => Number.isFinite(id) && id > 0);
  const usageById: Record<string, PoolUsage> = allIds.length ? await fetchPoolUsage(allIds).catch(() => ({})) : {};

  const stats = ownedStats(all, usageById);
  const { items, total } = applyPoolQuery(all, query);
  const withUsage = items.map((account) => ({ ...account, usage: usageById[String(account.id)] ?? null }));

  return { accounts: { items: withUsage, total }, stats, groups: null, capacity: POOL_CAPACITY, scoped: true };
}

function clampInt(raw: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}
