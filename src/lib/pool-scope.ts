import { listPoolAccounts, type PoolAccount, type PoolStats, type PoolUsage } from "@/lib/sub2api";

/**
 * Per-owner pool scoping helpers, shared by the pool list and ops routes.
 *
 * When a `user` is scoped to their own accounts, Sub2API's server-side
 * pagination can't filter by an id-set, so we do a bounded page-scan of the
 * account list and keep only the caller's owned ids. Everything downstream
 * (filter / sort / paginate / stats) is then computed IN MEMORY over the owned
 * subset — we never fall back to the GLOBAL dashboard stats, which would leak
 * pool-wide counts and cost to a regular user.
 */

const PAGE_SIZE = 100;
/** Ceiling on pages walked — mirrors the pool capacity (1000) / page size. */
const MAX_PAGES = 10;

/** Walk the Sub2API list (bounded) collecting only accounts the caller owns. */
export async function collectOwnedAccounts(ownedIds: Set<string>): Promise<PoolAccount[]> {
  if (ownedIds.size === 0) return [];
  const collected: PoolAccount[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { items } = await listPoolAccounts({ page, pageSize: PAGE_SIZE, sortBy: "created_at", sortOrder: "desc" });
    if (!items.length) break;

    for (const account of items) {
      if (account.id != null && ownedIds.has(String(account.id))) collected.push(account);
    }

    if (collected.length >= ownedIds.size) break; // found them all — stop early
    if (items.length < PAGE_SIZE) break; // reached the last page
  }

  return collected;
}

type PoolQuery = {
  search?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: string;
  page: number;
  pageSize: number;
};

/**
 * Filter (search/status) + sort + paginate the owned subset in memory.
 * Group filtering is intentionally omitted: the client sends a group *id* but a
 * PoolAccount only carries group *names*, and a scoped user owns few accounts.
 */
export function applyPoolQuery(all: PoolAccount[], query: PoolQuery): { items: PoolAccount[]; total: number } {
  let list = all;

  const search = query.search?.trim().toLowerCase();
  if (search) {
    list = list.filter(
      (account) =>
        (account.name ?? "").toLowerCase().includes(search) || (account.email ?? "").toLowerCase().includes(search),
    );
  }
  if (query.status) list = list.filter((account) => account.status === query.status);

  const order = query.sortOrder === "asc" ? 1 : -1;
  const key = query.sortBy || "created_at";
  list = [...list].sort((a, b) => compareBy(a, b, key) * order);

  const total = list.length;
  const start = (query.page - 1) * query.pageSize;
  return { items: list.slice(start, start + query.pageSize), total };
}

/** Aggregate strip computed from the owned subset — never the global dashboard. */
export function ownedStats(accounts: PoolAccount[], usageById?: Record<string, PoolUsage>): PoolStats {
  const now = Date.now();
  const future = (ts: string | null) => {
    if (!ts) return false;
    const parsed = Date.parse(ts);
    return Number.isFinite(parsed) && parsed > now;
  };

  let normal = 0;
  let error = 0;
  let ratelimit = 0;
  let overload = 0;
  let rpm = 0;
  let todayCost = 0;
  let todayRequests = 0;

  for (const account of accounts) {
    if (account.status === "error") error += 1;
    else if (account.status !== "disabled" && account.schedulable !== false) normal += 1;

    if (future(account.overloadUntil)) overload += 1;
    else if (future(account.rateLimitResetAt) || future(account.tempUnschedulableUntil)) ratelimit += 1;

    rpm += account.currentRpm ?? 0;

    const usage = usageById?.[String(account.id)];
    if (usage?.today) {
      todayCost += usage.today.cost;
      todayRequests += usage.today.requests;
    }
  }

  return {
    totalAccounts: accounts.length,
    normalAccounts: normal,
    errorAccounts: error,
    ratelimitAccounts: ratelimit,
    overloadAccounts: overload,
    todayCost,
    totalCost: 0,
    todayRequests,
    rpm, // sum of the caller's own current RPM — a personal gauge, not global
    tpm: 0, // no per-account TPM available
  };
}

function compareBy(a: PoolAccount, b: PoolAccount, key: string): number {
  switch (key) {
    case "name":
      return cmpStr(a.name, b.name);
    case "status":
      return cmpStr(a.status, b.status);
    case "rate_multiplier":
      return (a.rateMultiplier ?? 0) - (b.rateMultiplier ?? 0);
    case "last_used_at":
      return cmpDate(a.lastUsedAt, b.lastUsedAt);
    case "created_at":
    default:
      return cmpDate(a.createdAt, b.createdAt);
  }
}

function cmpStr(a: string | null, b: string | null): number {
  return (a ?? "").localeCompare(b ?? "");
}

function cmpDate(a: string | null, b: string | null): number {
  return toTime(a) - toTime(b);
}

function toTime(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
