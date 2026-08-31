import { NextResponse } from "next/server";
import { z } from "zod";

import { canUploadKey, effectiveTargetBackend, getAccessContext, provisioningAccess } from "@/lib/access";
import { recordPoolOwnership } from "@/lib/account-store";
import { resolveOpenAIConfig } from "@/lib/backends/registry";
import {
  countOpenAIAccountsByPrefix,
  createOpenAIApiKeyAccount,
  mapSub2ApiError,
  Sub2ApiError,
  type Sub2ApiRequestConfig,
} from "@/lib/sub2api";

export const dynamic = "force-dynamic";

// 授权上key: batch-upload OpenAI upstream accounts by API key. Targets the
// caller's assigned platform — the primary Sub2API (admin key) OR a password-auth
// Sub2API 网关 (sub2gw); other platforms are rejected. The upstream base_url is
// fixed to OpenAI's official API. Each account is named
// `<登录账号名>-<YYYYMMDD>-<NN>`, continuing the day's sequence on that instance.
const OPENAI_BASE_URL = "https://api.openai.com/v1";
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
    return sub2Error(error, "目标平台不可用");
  }

  const parsed = uploadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 });
  }

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

    const name = `${prefix}${String(startIndex + seq).padStart(2, "0")}`;
    seq += 1;
    try {
      const account = await createOpenAIApiKeyAccount({ name, apiKey, baseUrl: OPENAI_BASE_URL }, config);

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
      results.push({ key: maskKey(apiKey), name, ok: true, dead, error: dead ? account.errorMessage ?? "疑似死 Key（未通过校验）" : undefined });
    } catch (error) {
      const failure = mapSub2ApiError(error, "上传失败");
      if (!(error instanceof Sub2ApiError)) {
        console.error("[provisioning.openai.keys] failed", error instanceof Error ? error.message : error);
      }
      results.push({ key: maskKey(apiKey), name, ok: false, error: String((failure.body as { error?: string }).error ?? "上传失败") });
    }
  }

  const okCount = results.filter((item) => item.ok).length;
  const deadCount = results.filter((item) => item.dead).length;
  return NextResponse.json({ ok: okCount > 0, okCount, failCount: results.length - okCount, deadCount, results });
}

function sub2Error(error: unknown, fallback: string) {
  const failure = mapSub2ApiError(error, fallback);
  if (!(error instanceof Sub2ApiError)) {
    console.error("[provisioning.openai.keys] target resolve failed", error instanceof Error ? error.message : error);
  }
  return NextResponse.json(failure.body, { status: failure.status });
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
