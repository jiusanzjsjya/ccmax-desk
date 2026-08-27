import { NextResponse } from "next/server";

import { accountPoolAccess, getAccessContext } from "@/lib/access";
import { isSub2ApiConfigured } from "@/lib/backend-config";
import { mapSub2ApiError, scanPoolAlerts, Sub2ApiError } from "@/lib/sub2api";

export const dynamic = "force-dynamic";

/** Operator-set ceiling for how many accounts the pool is meant to carry. */
const POOL_CAPACITY = 1000;

/**
 * Ops / alerts data for the pool-review board: the aggregate strip plus a
 * pool-wide health scan (bounded) that surfaces problem accounts. Sub2API-only
 * — reuses the same verified endpoints as the account list, no new API surface.
 * Rule evaluation lives on the client; this route only returns raw signals.
 */
export async function GET(request: Request) {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!accountPoolAccess(context)) return NextResponse.json({ error: "account_pool_forbidden" }, { status: 403 });
  if (!(await isSub2ApiConfigured())) return NextResponse.json({ error: "sub2api_not_configured" }, { status: 503 });

  const params = new URL(request.url).searchParams;
  const scanMax = clampInt(params.get("scan_max"), 500, 100, POOL_CAPACITY);

  try {
    const scan = await scanPoolAlerts({ scanMax });
    return NextResponse.json({ ...scan, capacity: POOL_CAPACITY });
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
