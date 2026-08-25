import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { isValidClaudeAuthCode, normalizeClaudeAuthCode } from "@/lib/claude-auth-code";
import { acquireProvisioningFlow, deleteProvisioningFlow, releaseProvisioningFlow } from "@/lib/provisioning-state";
import { getCurrentSession } from "@/lib/session";
import { createClaudeAccount, exchangeClaudeCode, Sub2ApiError } from "@/lib/sub2api";

export const dynamic = "force-dynamic";

const completeSchema = z.object({
  flowId: z.string().uuid(),
  code: z.string().trim().min(1).max(4000),
  name: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
  groupIds: z.array(z.number().int().positive()).max(50).default([]),
});

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!env.isProvisioningConfigured) {
    return NextResponse.json({ error: "provisioning_not_configured" }, { status: 503 });
  }

  const parsed = completeSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 });
  }

  const normalizedCode = normalizeClaudeAuthCode(parsed.data.code);
  if (!isValidClaudeAuthCode(normalizedCode)) {
    return NextResponse.json(
      { error: "授权回执格式不正确，请粘贴完整的 code#state 或回调 URL" },
      { status: 400 },
    );
  }

  const flow = acquireProvisioningFlow(parsed.data.flowId, session.sessionId);

  if (!flow) {
    return NextResponse.json({ error: "flow_expired" }, { status: 410 });
  }

  try {
    const tokenInfo = await exchangeClaudeCode({
      sessionId: flow.sub2SessionId,
      code: normalizedCode,
    });

    if (!tokenInfo || typeof tokenInfo.access_token !== "string" || !tokenInfo.access_token) {
      throw new Sub2ApiError("Sub2API 未返回有效的 Claude OAuth token");
    }

    const accountName = parsed.data.name || buildDefaultName(tokenInfo, flow.flowId);
    const account = await createClaudeAccount({
      name: accountName,
      notes: parsed.data.notes,
      tokenInfo,
      groupIds: parsed.data.groupIds,
    });

    deleteProvisioningFlow(flow.flowId);
    return NextResponse.json({ ok: true, account });
  } catch (error) {
    releaseProvisioningFlow(flow.flowId);
    return sub2ErrorResponse(error, "Claude 账号接入失败");
  }
}

function buildDefaultName(tokenInfo: { email_address?: string; account_uuid?: string }, flowId: string) {
  return `Claude Code Max - ${tokenInfo.email_address || tokenInfo.account_uuid || flowId.slice(0, 8)}`;
}

function sub2ErrorResponse(error: unknown, fallback: string) {
  if (error instanceof Sub2ApiError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status && error.status >= 400 && error.status < 500 ? error.status : 502 });
  }

  console.error("[provisioning.complete] failed", error instanceof Error ? error.message : error);
  return NextResponse.json({ error: fallback }, { status: 502 });
}
