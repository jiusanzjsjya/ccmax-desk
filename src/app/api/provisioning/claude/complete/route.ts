import { NextResponse } from "next/server";
import { z } from "zod";

import { effectiveTargetBackend, getAccessContext, provisioningAccess } from "@/lib/access";
import { recordPoolOwnership } from "@/lib/account-store";
import { isBackendConfigured, isSub2ApiConfigured } from "@/lib/backend-config";
import { resolveBackend, resolveOAuthBroker } from "@/lib/backends/registry";
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
  // Target account pool ref ("sub2api" | "newapi" | "oneapi" | "custom:<id>").
  // Defaults to the superadmin's default backend when omitted.
  backend: z.string().trim().max(80).optional(),
  // Selected onboarding prefix; required (and prepended to notes) when the switch is on.
  prefixId: z.string().uuid().optional(),
  // Selected CCMax egress proxy (local bookkeeping); required when forcedProxyEnabled.
  egressProxyId: z.string().uuid().optional(),
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

  if (!(await isSub2ApiConfigured())) {
    return NextResponse.json({ error: "provisioning_not_configured" }, { status: 503 });
  }

  const parsed = completeSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 });
  }

  // Forced prefix: when the switch is on, a valid prefix must be selected and is
  // prepended to the batch note. Resolve server-side so the value is authoritative.
  let prefixValue: string | undefined;
  if (context.store.settings.forcedPrefixEnabled) {
    const prefix = parsed.data.prefixId
      ? context.store.accountPrefixes.find((item) => item.id === parsed.data.prefixId)
      : undefined;
    if (!prefix) {
      return NextResponse.json({ error: "prefix_required" }, { status: 400 });
    }
    prefixValue = prefix.value;
  }

  // Egress proxy: resolve a proxy the caller may use. Required when the toggle is
  // on. Purely local bookkeeping — the value is never forwarded to any backend.
  let egressProxyId: string | undefined;
  {
    const proxy = parsed.data.egressProxyId
      ? context.store.egressProxies.find((item) => item.id === parsed.data.egressProxyId)
      : undefined;
    const usable = proxy && (context.role === "superadmin" || proxy.ownerId === context.session.userId);
    if (context.store.settings.forcedProxyEnabled && !usable) {
      return NextResponse.json({ error: "proxy_required" }, { status: 400 });
    }
    egressProxyId = usable ? proxy!.id : undefined;
  }

  // Platform resolution:
  // - superadmin: honour the client-picked target (or fall back to the default).
  // - admin/user: force their superadmin-assigned platform, ignoring any client
  //   value. An unassigned account has no platform to onboard on — block it.
  let targetBackend: string | undefined;
  if (context.role === "superadmin") {
    targetBackend = parsed.data.backend;
  } else {
    const assigned = effectiveTargetBackend(context);
    if (!assigned) {
      return NextResponse.json({ error: "target_platform_unassigned" }, { status: 403 });
    }
    targetBackend = assigned;
  }

  if (targetBackend && !(await isBackendConfigured(targetBackend))) {
    return NextResponse.json({ error: "backend_not_configured" }, { status: 503 });
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
    const backend = await resolveBackend(targetBackend);
    const account = await backend.createClaudeAccount({
      name: accountName,
      notes: composeNotes(parsed.data.country, applyPrefix(prefixValue, parsed.data.notes)),
      tokenInfo,
      groupIds: parsed.data.groupIds,
    });

    // Attribute the account to the onboarding user for per-owner pool scoping.
    // Best-effort: the account already exists in the backend, so a failed
    // ownership write must not fail the onboard.
    if (account?.id != null) {
      const platformRef = targetBackend ?? context.store.backends.defaultBackend;
      await recordPoolOwnership({
        platform: platformRef,
        accountId: String(account.id),
        ownerId: context.session.userId,
        ownerUsername: context.session.username,
        proxyId: egressProxyId,
        createdAt: new Date().toISOString(),
      }).catch((error) => console.error("[provisioning.complete] ownership write failed", error));
    }

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

/** Prepend the forced prefix to the batch note (e.g. "Allen" + "0826" -> "Allen-0826"). */
function applyPrefix(prefix?: string, notes?: string) {
  if (!prefix) return notes;
  const rest = notes?.trim();
  return rest ? `${prefix}-${rest}` : prefix;
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
