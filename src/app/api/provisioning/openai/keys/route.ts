import { NextResponse } from "next/server";
import { z } from "zod";

import { canUploadKey, effectiveTargetBackend, getAccessContext, provisioningAccess } from "@/lib/access";
import { recordPoolOwnership } from "@/lib/account-store";
import { getOpenAIUploadGroupIds } from "@/lib/backend-config";
import { probeOpenAIKey } from "@/lib/openai-probe";
import { resolveOpenAIConfig } from "@/lib/backends/registry";
import {
  countOpenAIAccountsByPrefix,
  createOpenAIApiKeyAccount,
  deleteAccount,
  Sub2ApiError,
  testOpenAIAccount,
  type Sub2ApiRequestConfig,
} from "@/lib/sub2api";

export const dynamic = "force-dynamic";

// 授权上key: batch-upload OpenAI upstream accounts by API key. Targets the
// caller's assigned platform — the primary Sub2API (admin key) OR a password-auth
// Sub2API 网关 (sub2gw); other platforms are rejected. The upstream base_url,
// concurrency (并发) and target group are superadmin-configured system settings.
// Each account is named `<登录账号名>-<YYYYMMDD>-<NN>`, continuing the day's
// sequence on that instance.
const MAX_KEYS = 10;

// OpenAI secret keys are `sk-...` (legacy, `sk-proj-...`, `sk-svcacct-...`),
// alphanumerics plus `-`/`_`. Reject anything obviously not a key before we ever
// hit Sub2API, so malformed lines fail fast with a clear per-line reason.
const OPENAI_KEY_RE = /^sk-[A-Za-z0-9_-]{20,}$/;

const uploadSchema = z.object({
  keys: z.array(z.string().trim().min(1).max(500)).min(1).max(MAX_KEYS),
});

export async function POST(request: Request) {
  const context = await getAccessContext();
  if (!context) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const access = provisioningAccess(context);
  if (!access.allowed) return NextResponse.json({ error: access.error }, { status: access.status });

  // 授权上key module gate: default-deny unless the superadmin granted "key".
  if (!canUploadKey(context)) return NextResponse.json({ error: "module_forbidden" }, { status: 403 });

  // Target platform: superadmin uploads to the primary Sub2API; admin/user upload
  // to their superadmin-assigned platform (must be Sub2API or a Sub2API 网关).
  const ref = context.role === "superadmin" ? "sub2api" : effectiveTargetBackend(context);
  if (!ref) return NextResponse.json({ error: "target_platform_unassigned" }, { status: 403 });

  let config: Sub2ApiRequestConfig;
  try {
    config = await resolveOpenAIConfig(ref);
  } catch (error) {
    return sub2Error(error);
  }

  const parsed = uploadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 });
  }

  // Superadmin-configured upload defaults: base URL / concurrency / priority are
  // global; the target groups are per-instance (each Sub2API / sub2gw its own).
  const settings = context.store.settings;
  const baseUrl = settings.openaiUploadBaseUrl || undefined;
  const groupIds = await getOpenAIUploadGroupIds(ref);

  // Name binding: <登录账号名>-<YYYYMMDD>-<NN>. Continue the day's sequence by
  // counting accounts already named with this prefix on the target instance
  // (best-effort: fall back to 01 if the count lookup fails).
  const accountName = sanitizeName(context.session.displayName || context.session.username);
  const prefix = `${accountName}-${todayStamp()}-`;
  let startIndex = 1;
  try {
    startIndex = (await countOpenAIAccountsByPrefix(prefix, config)) + 1;
  } catch (error) {
    console.error("[provisioning.openai.keys] sequence count failed, starting at 01", error instanceof Error ? error.message : error);
  }

  const results: Array<{ key: string; name?: string; ok: boolean; dead?: boolean; error?: string }> = [];
  let seq = 0;
  for (const rawKey of parsed.data.keys) {
    const apiKey = rawKey.trim();
    if (!OPENAI_KEY_RE.test(apiKey)) {
      results.push({ key: maskKey(apiKey), ok: false, error: "格式不正确（应为 sk- 开头的 OpenAI Key）" });
      continue;
    }

    // Pre-create probe: send a minimal "hi" with the key straight to its base_url.
    // A conclusively-dead key is rejected here and NEVER creates an account.
    let preConfirmedAlive = false;
    if (settings.openaiUploadValidateKey) {
      const probe = await probeOpenAIKey(apiKey, baseUrl);
      if (probe.conclusive && !probe.alive) {
        const head = probe.status ? `[${probe.status}] ` : "";
        results.push({ key: maskKey(apiKey), ok: false, error: `校验未通过（死 Key），未入池：${head}${cleanMessage(probe.detail) || "密钥无效或已失效"}` });
        continue;
      }
      preConfirmedAlive = probe.conclusive && probe.alive;
    }

    const name = `${prefix}${String(startIndex + seq).padStart(2, "0")}`;
    seq += 1;
    try {
      const account = await createOpenAIApiKeyAccount(
        {
          name,
          apiKey,
          baseUrl,
          concurrency: settings.openaiUploadConcurrency,
          priority: settings.openaiUploadPriority,
          groupIds,
        },
        config,
      );

      // Fallback liveness test THROUGH the account, only when the pre-create probe
      // could NOT confirm the key (e.g. no direct egress to OpenAI from this host).
      if (settings.openaiUploadValidateKey && !preConfirmedAlive && account?.id != null) {
        const test = await testOpenAIAccount(account.id, config);
        if (test.conclusive && !test.alive) {
          await deleteAccount(account.id, config).catch((error) =>
            console.error("[provisioning.openai.keys] delete dead key failed", error instanceof Error ? error.message : error),
          );
          results.push({ key: maskKey(apiKey), name, ok: false, error: `校验未通过（死 Key），已删除未入池：${cleanMessage(test.detail)}` });
          continue;
        }
      }

      if (account?.id != null) {
        await recordPoolOwnership({
          platform: ref,
          accountId: String(account.id),
          ownerId: context.session.userId,
          ownerUsername: context.session.username,
          createdAt: new Date().toISOString(),
        }).catch((error) => console.error("[provisioning.openai.keys] ownership write failed", error));
      }

      // Dead-key surfacing: Sub2API probes api-key accounts, so a key that fails
      // validation comes back non-active / unschedulable or with an error note.
      const dead = account.status !== "active" || account.schedulable === false || Boolean(account.errorMessage);
      results.push({ key: maskKey(apiKey), name, ok: true, dead, error: dead ? cleanMessage(account.errorMessage ?? "疑似死 Key（未通过校验）") : undefined });
    } catch (error) {
      if (!(error instanceof Sub2ApiError)) {
        console.error("[provisioning.openai.keys] failed", error instanceof Error ? error.message : error);
      }
      results.push({ key: maskKey(apiKey), name, ok: false, error: uploadErrorMessage(error) });
    }
  }

  const okCount = results.filter((item) => item.ok).length;
  const deadCount = results.filter((item) => item.dead).length;
  return NextResponse.json({ ok: okCount > 0, okCount, failCount: results.length - okCount, deadCount, results });
}

// Whole-request failure (target resolve / gateway login). Report the real error
// but keep the HTTP status at 502 so the client never mistakes it for its own
// session-expiry 401 (which triggers a logout). The actual upstream status is
// carried inside the message as `[401]` etc.
function sub2Error(error: unknown) {
  if (!(error instanceof Sub2ApiError)) {
    console.error("[provisioning.openai.keys] target resolve failed", error instanceof Error ? error.message : error);
  }
  return NextResponse.json({ error: uploadErrorMessage(error) }, { status: 502 });
}

/**
 * Turn an upstream error into a user-facing message: the real HTTP status +
 * a category label + the actual detail, with gateway/product names stripped.
 * Never leaks the SUB2API_ADMIN_TOKEN hint or a specific gateway's name.
 */
function uploadErrorMessage(error: unknown): string {
  if (error instanceof Sub2ApiError) {
    const status = error.status;
    const detail = cleanMessage(error.message);
    // No HTTP status (e.g. gateway login rejected, connect failure): the message
    // already explains itself — show it directly, no "上传失败：" prefix.
    if (!status) return detail || "连接失败或服务不可达";
    const head = `[${status}] ${statusLabel(status)}`;
    return detail && !isGenericDetail(detail) ? `${head}：${detail}` : head;
  }
  return "连接失败或服务不可达";
}

/** Category label per HTTP status — several distinct kinds of validation error. */
function statusLabel(status?: number): string {
  switch (status) {
    case 400:
      return "请求无效";
    case 401:
      return "密钥无效或未授权";
    case 402:
      return "余额不足或欠费";
    case 403:
      return "无权限或被拒绝";
    case 404:
      return "资源不存在";
    case 408:
      return "请求超时";
    case 409:
      return "冲突（可能重复或分组混渠道）";
    case 422:
      return "参数校验失败";
    case 429:
      return "频率或额度限制";
    default:
      if (status && status >= 500) return "上游服务错误";
      return "上传失败";
  }
}

/** Strip gateway/product names so errors never leak backend identity. */
function cleanMessage(message: string): string {
  return message
    .replace(/Sub2API\s*网关/g, "目标平台")
    .replace(/Claude\s*Gateway/g, "目标平台")
    .replace(/Sub2API/g, "目标平台")
    .replace(/，?\s*请更新\s*SUB2API_ADMIN_TOKEN。?/g, "")
    .trim();
}

/** The generic "请求失败（HTTP xxx）" fallback adds nothing beyond the status label. */
function isGenericDetail(detail: string): boolean {
  return detail === "" || detail === "目标平台" || /请求失败（HTTP\s*\d+）/.test(detail);
}

/** Local-date stamp YYYYMMDD for the name binding. */
function todayStamp() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/** Keep account names clean: collapse whitespace, drop the hyphen we delimit on. */
function sanitizeName(raw: string) {
  return raw.replace(/\s+/g, "").replace(/-/g, "").slice(0, 40) || "user";
}

/** Redact a key for echoing back in results — head + tail only. */
function maskKey(key: string) {
  if (key.length <= 12) return `${key.slice(0, 3)}…`;
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}
