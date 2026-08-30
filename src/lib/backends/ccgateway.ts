import type { CcGateway } from "@/lib/account-store";
import { decryptSecret } from "@/lib/secret-box";
import { Sub2ApiError } from "@/lib/sub2api";
import type { PoolAccountSummary, PoolBackend } from "./types";

/**
 * "Claude Gateway" (self-built vendor pool) as a target backend.
 *
 * Unlike the generic `custom` gateway, this platform is driven by a VENDOR LOGIN
 * and its own account-import API — there is no static API key. The adapter:
 *   1. mints a short-lived JWT from the vendor email/password (cached ~13 min,
 *      the token lives 15), and
 *   2. imports the finished Claude account by its OAuth refresh_token.
 *
 * CONTRACT (mapped from the live gateway; see memory `claude-gateway-integration`):
 *   POST {baseUrl}/api/auth/admin-login
 *     body { identifier, email, password } -> { user, accessToken }   // JWT, 15 min
 *   POST {baseUrl}/api/admin/oauth-accounts/import-rt
 *     Header Authorization: Bearer <JWT>
 *     body { name, group_ids: string[], refresh_token }  // gateway refreshes the RT itself
 *   GET  {baseUrl}/api/admin/oauth-accounts?page=1&limit=50 -> { accounts: [...] }
 *   GET  {baseUrl}/api/admin/groups -> { items: [{ id, is_default, ... }] }  // default group
 */

type CachedAuth = { token: string; expiresAtMs: number };

// Per-instance JWT + default-group caches, keyed by gateway id.
const authCache = new Map<string, CachedAuth>();
const defaultGroupCache = new Map<string, string>();

const LOGIN_SKEW_MS = 60_000; // refresh a minute before the JWT actually expires

export function ccgatewayBackend(config: CcGateway): PoolBackend {
  const baseUrl = config.baseUrl.replace(/\/$/, "");

  return {
    kind: "ccgateway",
    label: config.name || "Claude Gateway",

    async createClaudeAccount(input) {
      const refreshToken = typeof input.tokenInfo.refresh_token === "string" ? input.tokenInfo.refresh_token : "";
      if (!refreshToken) {
        throw new Sub2ApiError("Claude Gateway 需要 refresh_token 才能导入账号，但本次授权未返回 refresh_token");
      }

      const token = await authenticate(config, baseUrl);
      const groupIds = await resolveGroupIds(config, baseUrl, token);

      const data = await request(baseUrl, "/api/admin/oauth-accounts/import-rt", token, {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          group_ids: groupIds,
          refresh_token: refreshToken,
        }),
      });

      const account = pickAccount(data);
      return {
        id: (account.id as number | string) ?? null,
        name: (account.name as string) ?? input.name,
        email: (account.email as string) ?? (account.email_address as string) ?? input.tokenInfo.email_address ?? null,
        platform: "anthropic",
        type: "oauth",
        status: (account.status as string) ?? "active",
        schedulable: (account.schedulable as boolean) ?? null,
        errorMessage: null,
        createdAt: (account.created_at as string) ?? null,
        backend: "ccgateway",
      } satisfies PoolAccountSummary;
    },

    async listClaudeAccounts() {
      const token = await authenticate(config, baseUrl);
      const data = await request(baseUrl, "/api/admin/oauth-accounts?page=1&limit=50", token, { method: "GET" });
      const rows = Array.isArray(data)
        ? data
        : Array.isArray((data as { accounts?: unknown })?.accounts)
          ? (data as { accounts: unknown[] }).accounts
          : Array.isArray((data as { items?: unknown })?.items)
            ? (data as { items: unknown[] }).items
            : [];

      const items = (rows as Array<Record<string, unknown>>).map((row) => ({
        id: (row.id as number | string) ?? null,
        name: (row.name as string) ?? null,
        email: (row.email as string) ?? (row.email_address as string) ?? null,
        platform: (row.platform as string) ?? "anthropic",
        type: (row.type as string) ?? "oauth",
        status: (row.status as string) ?? "active",
        schedulable: (row.schedulable as boolean) ?? null,
        errorMessage: (row.error_message as string) ?? null,
        createdAt: (row.created_at as string) ?? null,
        backend: "ccgateway" as const,
      }));

      return { items, total: items.length };
    },
  };
}

/** Return a valid JWT for this gateway, minting/caching one as needed. */
async function authenticate(config: CcGateway, baseUrl: string): Promise<string> {
  const cached = authCache.get(config.id);
  if (cached && cached.expiresAtMs - LOGIN_SKEW_MS > Date.now()) return cached.token;

  const password = decryptSecret(config.vendorPassword);
  if (!config.vendorEmail || !password) {
    throw new Sub2ApiError("Claude Gateway 未配置 vendor 邮箱或密码，请在超管后台填写");
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/auth/admin-login`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: config.vendorEmail, email: config.vendorEmail, password }),
      cache: "no-store",
    });
  } catch {
    throw new Sub2ApiError("无法连接 Claude Gateway，请检查地址和网络");
  }

  const payload = (await response.json().catch(() => null)) as { accessToken?: string; error?: string } | null;
  if (!response.ok || !payload?.accessToken) {
    const message = payload?.error || `Claude Gateway 登录失败（HTTP ${response.status}）`;
    throw new Sub2ApiError(message, response.status);
  }

  const token = payload.accessToken;
  authCache.set(config.id, { token, expiresAtMs: jwtExpiryMs(token) });
  return token;
}

/** The group_ids to import into: the configured one, else the gateway's default group. */
async function resolveGroupIds(config: CcGateway, baseUrl: string, token: string): Promise<string[]> {
  if (config.groupId) return [config.groupId];

  const cached = defaultGroupCache.get(config.id);
  if (cached) return [cached];

  const data = await request(baseUrl, "/api/admin/groups", token, { method: "GET" });
  const items = (Array.isArray((data as { items?: unknown })?.items) ? (data as { items: unknown[] }).items : []) as Array<
    Record<string, unknown>
  >;
  const groups = items.filter((item) => typeof item.id === "string");
  const chosen = (groups.find((item) => item.is_default === true) ?? groups[0])?.id as string | undefined;
  if (!chosen) {
    throw new Sub2ApiError("Claude Gateway 未返回任何分组，无法导入账号（vendor 账号必须归属分组）");
  }

  defaultGroupCache.set(config.id, chosen);
  return [chosen];
}

/** Authenticated JSON request against the gateway; unwraps a `{ data }` envelope. */
async function request(baseUrl: string, path: string, token: string, init: RequestInit) {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
      cache: "no-store",
    });
  } catch {
    throw new Sub2ApiError("无法连接 Claude Gateway，请检查地址和网络");
  }

  const rawBody = await response.text();
  const payload = parseJson(rawBody);

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload && typeof (payload as { error: unknown }).error === "string"
        ? (payload as { error: string }).error
        : `Claude Gateway 请求失败（HTTP ${response.status}）`;
    throw new Sub2ApiError(message, response.status);
  }

  if (typeof payload === "object" && payload !== null && "data" in payload) {
    return (payload as { data: unknown }).data;
  }
  return payload;
}

/** The import-rt response may be the account itself or wrapped; normalize to a record. */
function pickAccount(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (obj.account && typeof obj.account === "object") return obj.account as Record<string, unknown>;
    return obj;
  }
  return {};
}

/** Read the JWT `exp` (seconds) as epoch ms; fall back to 13 minutes out if unparseable. */
function jwtExpiryMs(token: string): number {
  const fallback = Date.now() + 13 * 60_000;
  const parts = token.split(".");
  if (parts.length !== 3) return fallback;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : fallback;
  } catch {
    return fallback;
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
