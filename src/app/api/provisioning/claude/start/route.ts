import { NextResponse } from "next/server";
import { z } from "zod";

import { canOnboard, canUseCustomProxy, getAccessContext, provisioningAccess } from "@/lib/access";
import { isSub2ApiConfigured } from "@/lib/backend-config";
import { resolveOAuthBroker } from "@/lib/backends/registry";
import {
  countOwnerFlows,
  createProvisioningFlow,
  MAX_ACTIVE_FLOWS_PER_OWNER,
  MAX_BATCH_SLOTS,
} from "@/lib/provisioning-state";
import { mapSub2ApiError, Sub2ApiError } from "@/lib/sub2api";

export const dynamic = "force-dynamic";

const startSchema = z.object({
  count: z.coerce.number().int().min(1).max(MAX_BATCH_SLOTS).default(1),
  proxyId: z.coerce.number().int().positive().optional(),
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

  // 授权上号 module gate: default-deny unless the superadmin granted "onboard".
  if (!canOnboard(context)) {
    return NextResponse.json({ error: "module_forbidden" }, { status: 403 });
  }

  if (!(await isSub2ApiConfigured())) {
    return NextResponse.json({ error: "provisioning_not_configured" }, { status: 503 });
  }

  const parsed = startSchema.safeParse((await request.json().catch(() => null)) ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 });
  }

  // A Sub2API proxy is superadmin-only; admin/user route through local egress proxies
  // instead, so reject a proxyId from anyone who can't use custom proxies.
  if (parsed.data.proxyId !== undefined && !canUseCustomProxy(context)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const owned = countOwnerFlows(context.session.sessionId);
  const room = Math.max(0, MAX_ACTIVE_FLOWS_PER_OWNER - owned);
  const count = Math.min(parsed.data.count, room);

  if (count <= 0) {
    return NextResponse.json({ error: "too_many_active_slots" }, { status: 429 });
  }

  const broker = resolveOAuthBroker();
  const slots: Array<{ flowId: string; authUrl: string; expiresAt: string }> = [];

  try {
    // Each slot is an independent OAuth handshake, so generate them sequentially.
    for (let index = 0; index < count; index += 1) {
      const authorization = await broker.generateClaudeAuthUrl({ proxyId: parsed.data.proxyId });
      const flow = createProvisioningFlow({
        ownerSessionId: context.session.sessionId,
        sub2SessionId: authorization.session_id,
        authUrl: authorization.auth_url,
      });
      slots.push({
        flowId: flow.flowId,
        authUrl: flow.authUrl,
        expiresAt: new Date(flow.expiresAt).toISOString(),
      });
    }
  } catch (error) {
    // Return any slots already created so the operator can still use them.
    if (slots.length === 0) {
      return sub2ErrorResponse(error, "生成 Claude 授权地址失败");
    }
    return NextResponse.json({ slots, partial: true });
  }

  return NextResponse.json({ slots });
}

function sub2ErrorResponse(error: unknown, fallback: string) {
  const failure = mapSub2ApiError(error, fallback);
  if (!(error instanceof Sub2ApiError)) {
    console.error("[provisioning.start] failed", error instanceof Error ? error.message : error);
  }

  return NextResponse.json(failure.body, { status: failure.status });
}
