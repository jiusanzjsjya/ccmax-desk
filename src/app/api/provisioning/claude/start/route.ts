import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { createProvisioningFlow } from "@/lib/provisioning-state";
import { getCurrentSession } from "@/lib/session";
import { generateClaudeAuthUrl, Sub2ApiError } from "@/lib/sub2api";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!env.isProvisioningConfigured) {
    return NextResponse.json({ error: "provisioning_not_configured" }, { status: 503 });
  }

  try {
    const authorization = await generateClaudeAuthUrl();
    const flow = createProvisioningFlow({
      ownerSessionId: session.sessionId,
      sub2SessionId: authorization.session_id,
      authUrl: authorization.auth_url,
    });

    return NextResponse.json({
      flowId: flow.flowId,
      authUrl: flow.authUrl,
      expiresAt: new Date(flow.expiresAt).toISOString(),
    });
  } catch (error) {
    return sub2ErrorResponse(error, "生成 Claude 授权地址失败");
  }
}

function sub2ErrorResponse(error: unknown, fallback: string) {
  if (error instanceof Sub2ApiError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status && error.status >= 400 && error.status < 500 ? error.status : 502 });
  }

  console.error("[provisioning.start] failed", error instanceof Error ? error.message : error);
  return NextResponse.json({ error: fallback }, { status: 502 });
}
