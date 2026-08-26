import { NextResponse } from "next/server";
import { z } from "zod";

import { getAccessContext, provisioningAccess } from "@/lib/access";
import { resolveBackend, resolveOAuthBroker } from "@/lib/backends/registry";
import { env } from "@/lib/env";
import { isValidClaudeAuthCode, normalizeClaudeAuthCode } from "@/lib/claude-auth-code";
import { acquireProvisioningFlow, deleteProvisioningFlow, releaseProvisioningFlow } from "@/lib/provisioning-state";
import { mapSub2ApiError, Sub2ApiError } from "@/lib/sub2api";

export const dynamic = "force-dynamic";

const completeSchema = z.object({
  flowId: z.string().uuid(),
  code: z.string().trim().min(1).max(4000),
  name: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
  // Local label only; Sub2API has no country field, so it is folded into notes.
  country: z.string().trim().max(60).optional(),
  groupIds: z.array(z.number().int().positive()).max(50).default([]),
});

export async function POST(request: Request) {
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

  if (!env.isBackendConfigured(env.BACKEND_KIND)) {
    return NextResponse.json({ error: "backend_not_configured" }, { status: 503 });
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

  const flow = acquireProvisioningFlow(parsed.data.flowId, context.session.sessionId);

  if (!flow) {
    return NextResponse.json({ error: "flow_expired" }, { status: 410 });
  }

  try {
    const tokenInfo = await resolveOAuthBroker().exchangeClaudeCode({
      sessionId: flow.sub2SessionId,
      code: normalizedCode,
    });

    if (!tokenInfo || typeof tokenInfo.access_token !== "string" || !tokenInfo.access_token) {
      throw new Sub2ApiError("Sub2API 未返回有效的 Claude OAuth token");
    }

    const accountName = parsed.data.name || buildDefaultName(tokenInfo, flow.flowId);
    const account = await resolveBackend().createClaudeAccount({
      name: accountName,
      notes: composeNotes(parsed.data.country, parsed.data.notes),
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

/** Country is a local label only; prepend it to notes as a tag when present. */
function composeNotes(country?: string, notes?: string) {
  const tag = country ? `[${country}]` : "";
  const combined = [tag, notes].filter(Boolean).join(" ").trim();
  return combined || undefined;
}

function sub2ErrorResponse(error: unknown, fallback: string) {
  const failure = mapSub2ApiError(error, fallback);
  if (!(error instanceof Sub2ApiError)) {
    console.error("[provisioning.complete] failed", error instanceof Error ? error.message : error);
  }

  return NextResponse.json(failure.body, { status: failure.status });
}
