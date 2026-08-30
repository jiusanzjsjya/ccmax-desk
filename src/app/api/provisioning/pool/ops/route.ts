import { NextResponse } from "next/server";

import { accountPoolAccess, effectiveTargetBackend, getAccessContext, poolScope } from "@/lib/access";
import { listOwnedAccountIds } from "@/lib/account-store";
import { isSub2ApiConfigured } from "@/lib/backend-config";
import { refKind } from "@/lib/backends/kinds";
import { collectOwnedAccounts, ownedStats } from "@/lib/pool-scope";
import { mapSub2ApiError, scanPoolAlerts, Sub2ApiError } from "@/lib/sub2api";

export const dynamic = "force-dynamic";

/** Operator-set ceiling for how many accounts the pool is meant to carry. */
const POOL_CAPACITY = 1000;

/**
 * Ops / alerts data for the pool-review board: the aggregate strip plus a
 * pool-wide health scan (bounded) that surfaces problem accounts. Sub2API-only
 * — reuses the same verified endpoints as the account list, no new API surface.
 * Rule evaluation lives on the client; this route only returns raw signals.
 *
 * A regular `user` is scoped to their own accounts: the "pool" here is just the
 * caller's owned set, and all aggregates are computed from it (never the global
 * dashboard). Non-Sub2API platforms return a `pending` placeholder.
 */
export async function GET(request: Request) {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!accountPoolAccess(context)) return NextResponse.json({ error: "account_pool_forbidden" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  let platform = (params.get("platform") || "sub2api").slice(0, 80);
  // admin/user are locked to their assigned platform — override the query value.
  if (context.role !== "superadmin") {
    const target = effectiveTargetBackend(context);
    if (!target) return NextResponse.json({ pending: true, platform: null, targetUnassigned: true });
    platform = target;
  }
  if (refKind(platform) !== "sub2api") {
    return NextResponse.json({ pending: true, platform });
  }

  if (!(await isSub2ApiConfigured())) return NextResponse.json({ error: "sub2api_not_configured" }, { status: 503 });

  const scanMax = clampInt(params.get("scan_max"), 500, 100, POOL_CAPACITY);
  const scope = poolScope(context);

  try {
    if (scope.scoped) {
      const owned = await listOwnedAccountIds(platform, scope.ownerId!);
      const accounts = owned.size ? await collectOwnedAccounts(owned) : [];
      const concurrencySum = accounts.reduce((sum, account) => sum + (account.currentConcurrency ?? 0), 0);
      return NextResponse.json({
        stats: ownedStats(accounts),
        // The client applies alert rules; sending the whole owned set is cheap
        // (a user owns few accounts) and lets every rule evaluate.
        notable: accounts,
        scanned: accounts.length,
        truncated: false,
        concurrencySum,
        capacity: POOL_CAPACITY,
        scoped: true,
      });
    }

    const scan = await scanPoolAlerts({ scanMax });
    return NextResponse.json({ ...scan, capacity: POOL_CAPACITY, scoped: false });
  } catch (error) {
    const failure = mapSub2ApiError(error, "读取账号池运维数据失败");
    if (!(error instanceof Sub2ApiError)) {
      console.error("[provisioning.pool.ops] failed", error instanceof Error ? error.message : error);
    }
    return NextResponse.json(failure.body, { status: failure.status });
  }
}

function clampInt(raw: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}
