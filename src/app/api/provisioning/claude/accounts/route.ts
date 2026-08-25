import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { getCurrentSession } from "@/lib/session";
import { listClaudeAccounts, Sub2ApiError } from "@/lib/sub2api";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!env.isProvisioningConfigured) {
    return NextResponse.json({ error: "provisioning_not_configured" }, { status: 503 });
  }

  try {
    return NextResponse.json(await listClaudeAccounts());
  } catch (error) {
    if (error instanceof Sub2ApiError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status && error.status >= 400 && error.status < 500 ? error.status : 502 },
      );
    }

    console.error("[provisioning.accounts] failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "读取 Sub2API 账号列表失败" }, { status: 502 });
  }
}
