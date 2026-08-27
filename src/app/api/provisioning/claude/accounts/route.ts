import { NextResponse } from "next/server";

import { accountPoolAccess, getAccessContext } from "@/lib/access";
import { isBackendConfigured } from "@/lib/backend-config";
import { resolveBackend } from "@/lib/backends/registry";
import { mapSub2ApiError, Sub2ApiError } from "@/lib/sub2api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getAccessContext();

  if (!context) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!accountPoolAccess(context)) {
    return NextResponse.json({ error: "account_pool_forbidden" }, { status: 403 });
  }

  // A backend ref ("sub2api" | "newapi" | "oneapi" | "custom:<id>"); omitted → default.
  const backendParam = new URL(request.url).searchParams.get("backend");
  const backend = backendParam && backendParam.length <= 80 ? backendParam : undefined;

  if (backend && !(await isBackendConfigured(backend))) {
    return NextResponse.json({ error: "backend_not_configured" }, { status: 503 });
  }

  try {
    const pool = await resolveBackend(backend);
    return NextResponse.json(await pool.listClaudeAccounts());
  } catch (error) {
    const failure = mapSub2ApiError(error, "读取账号列表失败");
    if (!(error instanceof Sub2ApiError)) {
      console.error("[provisioning.accounts] failed", error instanceof Error ? error.message : error);
    }

    return NextResponse.json(failure.body, { status: failure.status });
  }
}
