import type { Sub2Gw } from "@/lib/account-store";
import { decryptSecret } from "@/lib/secret-box";
import { createClaudeAccount, listClaudeAccounts, Sub2ApiError, type Sub2ApiRequestConfig } from "@/lib/sub2api";
import type { PoolAccountSummary, PoolBackend } from "./types";

/**
 * A password-auth Sub2API instance as a target backend.
 *
 * It is the SAME Sub2API software/endpoints as the primary `sub2api` backend,
 * but instead of a long-lived admin API key it authenticates by an admin account
 * login (email/password → short-lived JWT). The adapter mints + caches that JWT
 * and hands a {@link Sub2ApiRequestConfig} to the shared Sub2API client functions,
 * so 上号 / 上key / 账号池 all work against this instance. Used mainly for OpenAI
 * 上key.
 *
 * CONTRACT (VERIFIED against Sub2API source, Wei-Shaw/sub2api auth_handler.go):
 *   POST {baseUrl}/api/v1/auth/login
 *     body { email, password }
 *     -> { access_token, refresh_token?, expires_in?, token_type:"Bearer" }
 *     -> or { requires_2fa, temp_token, ... } when the admin account has 2FA on.
 *   Admin endpoints then accept `Authorization: Bearer <access_token>` (role=admin).
 */

type CachedAuth = { token: string; expiresAtMs: number };

const authCache = new Map<string, CachedAuth>();
const LOGIN_SKEW_MS = 60_000; // refresh a minute before the JWT expires

/** A Sub2API request config for this gateway, minting/caching a JWT as needed. */
export async function sub2GwRequestConfig(config: Sub2Gw): Promise<Sub2ApiRequestConfig> {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const token = await authenticate(config, baseUrl);
  return { baseUrl, adminToken: token };
}

export function sub2gwBackend(config: Sub2Gw): PoolBackend {
  return {
    kind: "sub2gw",
    label: config.name || "Sub2API 网关",

    async createClaudeAccount(input) {
      const cfg = await sub2GwRequestConfig(config);
      const summary = await createClaudeAccount(
        { name: input.name, notes: input.notes, tokenInfo: input.tokenInfo, groupIds: input.groupIds },
        cfg,
      );
      return { ...summary, backend: "sub2gw" } satisfies PoolAccountSummary;
    },

    async listClaudeAccounts() {
      const cfg = await sub2GwRequestConfig(config);
      const { items, total } = await listClaudeAccounts(cfg);
      return { items: items.map((item) => ({ ...item, backend: "sub2gw" as const })), total };
    },
  };
}

/** Return a valid admin JWT for this gateway, logging in + caching as needed. */
async function authenticate(config: Sub2Gw, baseUrl: string): Promise<string> {
  const cached = authCache.get(config.id);
  if (cached && cached.expiresAtMs - LOGIN_SKEW_MS > Date.now()) return cached.token;

  const password = decryptSecret(config.adminPassword);
  if (!config.adminEmail || !password) {
    throw new Sub2ApiError("Sub2API 网关未配置管理员邮箱或密码，请在超管后台填写");
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ email: config.adminEmail, password }),
      cache: "no-store",
    });
  } catch {
    throw new Sub2ApiError("无法连接 Sub2API 网关，请检查地址和网络");
  }

  const raw = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const body = pickAuthBody(raw);

  if (!response.ok) {
    const message = typeof raw?.message === "string" ? raw.message : `Sub2API 网关登录失败（HTTP ${response.status}）`;
    throw new Sub2ApiError(message, response.status);
  }
  if (body?.requires_2fa) {
    throw new Sub2ApiError("该 Sub2API 网关管理员账号开启了两步验证(2FA)，暂不支持自动登录，请改用未开 2FA 的管理员账号");
  }

  const token = body?.access_token;
  if (typeof token !== "string" || !token) {
    throw new Sub2ApiError("Sub2API 网关登录未返回 access_token");
  }

  const expiresIn = typeof body?.expires_in === "number" ? body.expires_in : null;
  const expiresAtMs = expiresIn ? Date.now() + expiresIn * 1000 : jwtExpiryMs(token);
  authCache.set(config.id, { token, expiresAtMs });
  return token;
}

/** Auth payload may be at the top level or under a `{ data }` envelope. */
function pickAuthBody(raw: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!raw) return null;
  if ("access_token" in raw || "requires_2fa" in raw) return raw;
  if (raw.data && typeof raw.data === "object") return raw.data as Record<string, unknown>;
  return raw;
}

/** Read the JWT `exp` (seconds) as epoch ms; fall back to 10 minutes out. */
function jwtExpiryMs(token: string): number {
  const fallback = Date.now() + 10 * 60_000;
  const parts = token.split(".");
  if (parts.length !== 3) return fallback;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : fallback;
  } catch {
    return fallback;
  }
}
