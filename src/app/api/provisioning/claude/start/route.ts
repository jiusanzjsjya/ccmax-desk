import { NextResponse } from "next/server";

import { getAccessContext, provisioningAccess } from "@/lib/access";
import { env } from "@/lib/env";
import { createProvisioningFlow } from "@/lib/provisioning-state";
import { generateClaudeAuthUrl, mapSub2ApiError, Sub2ApiError } from "@/lib/sub2api";

export const dynamic = "force-dynamic";

export async function POST() {
  const context = await getAccessContext();

  if (!context) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const access = provisioningAccess(context);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  if (!env.isProvisioningConfigured) {
    return NextResponse.json({ error: "provisioning_not_configured" }, { status: 503 });
  }

  try {
    const authorization = await generateClaudeAuthUrl();
    const flow = createProvisioningFlow({
      ownerSessionId: context.session.sessionId,
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
  const failure = mapSub2ApiError(error, fallback);
  if (!(error instanceof Sub2ApiError)) {
    console.error("[provisioning.start] failed", error instanceof Error ? error.message : error);
  }

  return NextResponse.json(failure.body, { status: failure.status });
}
