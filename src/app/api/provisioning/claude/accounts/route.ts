import { NextResponse } from "next/server";

import { accountPoolAccess, getAccessContext } from "@/lib/access";
import { resolveBackend } from "@/lib/backends/registry";
import { env } from "@/lib/env";
import { mapSub2ApiError, Sub2ApiError } from "@/lib/sub2api";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getAccessContext();

  if (!context) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!accountPoolAccess(context)) {
    return NextResponse.json({ error: "account_pool_forbidden" }, { status: 403 });
  }

  if (!env.isBackendConfigured(env.BACKEND_KIND)) {
    return NextResponse.json({ error: "backend_not_configured" }, { status: 503 });
  }

  try {
    return NextResponse.json(await resolveBackend().listClaudeAccounts());
  } catch (error) {
    const failure = mapSub2ApiError(error, "读取账号列表失败");
    if (!(error instanceof Sub2ApiError)) {
      console.error("[provisioning.accounts] failed", error instanceof Error ? error.message : error);
    }

    return NextResponse.json(failure.body, { status: failure.status });
  }
}
