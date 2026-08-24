import { getSub2ApiConfig } from "@/lib/env";

export type ClaudeTokenInfo = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  expires_at?: number;
  refresh_token?: string;
  scope?: string;
  org_uuid?: string;
  account_uuid?: string;
  email_address?: string;
  [key: string]: unknown;
};

export type Sub2ApiAccountSummary = {
  id: number | string | null;
  name: string | null;
  platform: string;
  type: string;
  status: string;
  schedulable: boolean | null;
  errorMessage: string | null;
};

type RawSub2ApiAccount = {
  id?: number | string;
  name?: string;
  platform?: string;
  type?: string;
  status?: string;
  schedulable?: boolean;
  error_message?: string | null;
};

export class Sub2ApiError extends Error {
  constructor(message: string, public readonly status?: number, public readonly code?: string) {
    super(message);
    this.name = "Sub2ApiError";
  }
}

export async function generateClaudeAuthUrl() {
  const config = getSub2ApiConfig();
  const result = await request<GenerateAuthUrlResponse>(config, "/api/v1/admin/accounts/generate-auth-url", {
    method: "POST",
    body: JSON.stringify(config.proxyId ? { proxy_id: config.proxyId } : {}),
  });

  if (!result.auth_url || !result.session_id) {
    throw new Sub2ApiError("Sub2API 未返回有效的授权 URL 或 session_id");
  }

  return result;
}

export async function exchangeClaudeCode(flow: { sessionId: string; code: string }) {
  const config = getSub2ApiConfig();
  return request<ClaudeTokenInfo>(config, "/api/v1/admin/accounts/exchange-code", {
    method: "POST",
    body: JSON.stringify({
      session_id: flow.sessionId,
      code: flow.code,
      ...(config.proxyId ? { proxy_id: config.proxyId } : {}),
    }),
  });
}

export async function createClaudeAccount(input: {
  name: string;
  notes?: string;
  tokenInfo: ClaudeTokenInfo;
  groupIds?: number[];
}) {
  const config = getSub2ApiConfig();
  const { tokenInfo } = input;
  const response = await request<RawSub2ApiAccount>(config, "/api/v1/admin/accounts", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      notes: input.notes || undefined,
      platform: "anthropic",
      type: "oauth",
      credentials: tokenInfo,
      extra: compactExtra(tokenInfo),
      ...(config.proxyId ? { proxy_id: config.proxyId } : {}),
      group_ids: input.groupIds ?? [],
      concurrency: 3,
      priority: 50,
      rate_multiplier: 1,
      auto_pause_on_expired: true,
    }),
  });

  return summarizeAccount(response);
}

type GenerateAuthUrlResponse = {
  auth_url: string;
  session_id: string;
};

async function request<T>(
  config: ReturnType<typeof getSub2ApiConfig>,
  path: string,
  init: RequestInit,
) {
  let response: Response;

  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.adminToken}`,
        ...init.headers,
      },
      cache: "no-store",
    });
  } catch {
    throw new Sub2ApiError("无法连接 Sub2API，请检查地址和网络");
  }

  const rawBody = await response.text();
  const payload = parseJson(rawBody);

  if (!response.ok) {
    throw new Sub2ApiError(
      redactMessage(readMessage(payload) ?? `Sub2API 请求失败（HTTP ${response.status}）`),
      response.status,
      readCode(payload),
    );
  }

  if (isApiEnvelope(payload)) {
    if (payload.code !== 0) {
      throw new Sub2ApiError(redactMessage(payload.message || "Sub2API 返回业务错误"), response.status, String(payload.code));
    }

    return payload.data as T;
  }

  return payload as T;
}

function compactExtra(tokenInfo: ClaudeTokenInfo) {
  return {
    ...(tokenInfo.org_uuid ? { org_uuid: tokenInfo.org_uuid } : {}),
    ...(tokenInfo.account_uuid ? { account_uuid: tokenInfo.account_uuid } : {}),
    ...(tokenInfo.email_address ? { email_address: tokenInfo.email_address } : {}),
  };
}

function summarizeAccount(value: RawSub2ApiAccount) {
  return {
    id: value?.id ?? null,
    name: value?.name ?? null,
    platform: value?.platform ?? "anthropic",
    type: value?.type ?? "oauth",
    status: value?.status ?? "active",
    schedulable: value?.schedulable ?? null,
    errorMessage: value?.error_message ?? null,
  } satisfies Sub2ApiAccountSummary;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function isApiEnvelope(value: unknown): value is { code: number; message?: string; data?: unknown } {
  return typeof value === "object" && value !== null && "code" in value && typeof value.code === "number";
}

function readMessage(value: unknown) {
  if (typeof value === "object" && value !== null && "message" in value && typeof value.message === "string") {
    return value.message;
  }

  if (typeof value === "string" && value.trim()) {
    return value.slice(0, 300);
  }

  return null;
}

function readCode(value: unknown) {
  if (typeof value === "object" && value !== null && "code" in value && (typeof value.code === "string" || typeof value.code === "number")) {
    return String(value.code);
  }

  return undefined;
}

function redactMessage(value: string) {
  return value
    .replace(/Bearer\s+[^\s,]+/gi, "Bearer [redacted]")
    .replace(/(access_token|refresh_token|sessionKey|session_key)["'=:\s]+[^,\s"'}]+/gi, "$1=[redacted]");
}
