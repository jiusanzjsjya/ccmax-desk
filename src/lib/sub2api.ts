import { getSub2ApiConfig } from "@/lib/backend-config";

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
  email: string | null;
  platform: string;
  type: string;
  status: string;
  schedulable: boolean | null;
  errorMessage: string | null;
  createdAt: string | null;
  // Optional richer fields; null when the backend does not report them.
  displayName?: string | null;
  subscription?: string | null;
  deadCause?: string | null;
};

type RawSub2ApiAccount = {
  id?: number | string;
  name?: string;
  email?: string;
  email_address?: string;
  platform?: string;
  type?: string;
  status?: string;
  schedulable?: boolean;
  error_message?: string | null;
  created_at?: string;
  account_display_name?: string;
  display_name?: string;
  subscription_type?: string;
  subscription_tier?: string;
  lifecycle_dead_cause?: string | null;
  lifecycle_status?: string;
};

type RawSub2ApiAccountList = {
  items?: RawSub2ApiAccount[];
  accounts?: RawSub2ApiAccount[];
  total?: number;
};

export class Sub2ApiError extends Error {
  constructor(message: string, public readonly status?: number, public readonly code?: string) {
    super(message);
    this.name = "Sub2ApiError";
  }
}

export function mapSub2ApiError(error: unknown, fallback: string) {
  if (error instanceof Sub2ApiError) {
    const isAuthenticationFailure = error.status === 401 || error.status === 403;
    return {
      status: isAuthenticationFailure
        ? 502
        : error.status && error.status >= 400 && error.status < 500
          ? error.status
          : 502,
      body: {
        error: isAuthenticationFailure
          ? "Sub2API 管理令牌无效或权限不足，请更新 SUB2API_ADMIN_TOKEN。"
          : error.message,
        code: isAuthenticationFailure ? "sub2api_auth_failed" : error.code,
      },
    };
  }

  return {
    status: 502,
    body: { error: fallback },
  };
}

export async function generateClaudeAuthUrl(opts?: { proxyId?: number }) {
  const config = await getSub2ApiConfig();
  // Per-request proxy_id (an existing Sub2API proxy) overrides the env default.
  const proxyId = opts?.proxyId ?? config.proxyId;
  const result = await request<GenerateAuthUrlResponse>(config, "/api/v1/admin/accounts/generate-auth-url", {
    method: "POST",
    body: JSON.stringify(proxyId ? { proxy_id: proxyId } : {}),
  });

  if (!result.auth_url || !result.session_id) {
    throw new Sub2ApiError("Sub2API 未返回有效的授权 URL 或 session_id");
  }

  return result;
}

export type ProxySummary = {
  id: number | string;
  name: string | null;
  protocol: string | null;
  host: string | null;
  port: number | null;
  status: string | null;
  latencyMs: number | null;
};

export type ProxyTestResult = {
  success: boolean;
  message: string | null;
  latencyMs: number | null;
  exitIp: string | null;
};

/** List Sub2API's managed proxies (never returns credentials). */
export async function listProxies(): Promise<ProxySummary[]> {
  const config = await getSub2ApiConfig();
  const result = await request<unknown>(config, "/api/v1/admin/proxies", { method: "GET" });
  const rows = Array.isArray(result)
    ? result
    : ((result as { items?: unknown[]; proxies?: unknown[] })?.items ??
      (result as { proxies?: unknown[] })?.proxies ??
      []);
  return (rows as Array<Record<string, unknown>>).map(summarizeProxy);
}

/** Test an existing Sub2API proxy by id (POST /admin/proxies/:id/test). */
export async function testProxy(id: number): Promise<ProxyTestResult> {
  const config = await getSub2ApiConfig();
  const result = await request<Record<string, unknown>>(config, `/api/v1/admin/proxies/${id}/test`, {
    method: "POST",
  });
  return {
    success: Boolean(result?.success),
    message: readString(result, "message"),
    latencyMs: readNumber(result, "latency_ms") ?? readNumber(result, "latencyMs"),
    exitIp: readString(result, "exit_ip") ?? readString(result, "exitIp"),
  };
}

function summarizeProxy(row: Record<string, unknown>): ProxySummary {
  return {
    id: (row.id as number | string) ?? "",
    name: (row.name as string) ?? null,
    protocol: (row.protocol as string) ?? null,
    host: (row.host as string) ?? null,
    port: typeof row.port === "number" ? row.port : null,
    status: (row.status as string) ?? null,
    latencyMs: readNumber(row, "latency_ms") ?? readNumber(row, "latencyMs"),
  };
}

function readString(obj: unknown, key: string): string | null {
  if (obj && typeof obj === "object" && key in obj) {
    const value = (obj as Record<string, unknown>)[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function readNumber(obj: unknown, key: string): number | null {
  if (obj && typeof obj === "object" && key in obj) {
    const value = (obj as Record<string, unknown>)[key];
    if (typeof value === "number") return value;
  }
  return null;
}

export async function exchangeClaudeCode(flow: { sessionId: string; code: string }) {
  const config = await getSub2ApiConfig();
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
  const config = await getSub2ApiConfig();
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

export async function listClaudeAccounts() {
  const config = await getSub2ApiConfig();
  const query = new URLSearchParams({
    page: "1",
    page_size: "50",
    platform: "anthropic",
    type: "oauth",
    lite: "true",
    sort_by: "created_at",
    sort_order: "desc",
  });
  const result = await request<RawSub2ApiAccountList | RawSub2ApiAccount[]>(config, `/api/v1/admin/accounts?${query}`, {
    method: "GET",
  });
  const items = Array.isArray(result) ? result : result.items || result.accounts || [];

  return {
    items: items.map(summarizeAccount),
    total: Array.isArray(result) ? items.length : result.total ?? items.length,
  };
}

/**
 * Richer account record for the pool-review dashboard. Everything here comes
 * straight from the list endpoint (VERIFIED against Sub2API v0.1.180): identity,
 * limits + live runtime, health + cooldown timestamps, groups. Per-account
 * cost/usage (5h/7d/30d) is NOT here — that needs the batch stats endpoints (P2).
 */
export type PoolAccount = {
  id: number | string | null;
  name: string | null;
  email: string | null;
  platform: string;
  type: string;
  status: string;
  schedulable: boolean | null;
  errorMessage: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  subscription: string | null;
  groups: string[];
  rateMultiplier: number | null;
  concurrency: number | null;
  currentConcurrency: number | null;
  baseRpm: number | null;
  currentRpm: number | null;
  windowCostLimit: number | null;
  currentWindowCost: number | null;
  maxSessions: number | null;
  activeSessions: number | null;
  rateLimitResetAt: string | null;
  overloadUntil: string | null;
  tempUnschedulableUntil: string | null;
  tempUnschedulableReason: string | null;
  sessionWindowEnd: string | null;
  sessionWindowStatus: string | null;
};

/** Aggregate strip from GET /admin/dashboard/stats (no per-window cost split). */
export type PoolStats = {
  totalAccounts: number;
  normalAccounts: number;
  errorAccounts: number;
  ratelimitAccounts: number;
  overloadAccounts: number;
  todayCost: number;
  totalCost: number;
  todayRequests: number;
  rpm: number;
  tpm: number;
};

type RawPoolAccount = {
  id?: number | string;
  name?: string;
  platform?: string;
  type?: string;
  status?: string;
  schedulable?: boolean;
  error_message?: string | null;
  created_at?: string;
  last_used_at?: string | null;
  email?: string;
  email_address?: string;
  parent_email?: string;
  subscription_type?: string;
  rate_multiplier?: number;
  concurrency?: number;
  current_concurrency?: number;
  base_rpm?: number | null;
  current_rpm?: number | null;
  window_cost_limit?: number | null;
  current_window_cost?: number | null;
  max_sessions?: number | null;
  active_sessions?: number | null;
  rate_limited_at?: string | null;
  rate_limit_reset_at?: string | null;
  overload_until?: string | null;
  temp_unschedulable_until?: string | null;
  temp_unschedulable_reason?: string;
  session_window_end?: string | null;
  session_window_status?: string;
  extra?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  groups?: Array<{ id?: number; name?: string } | null>;
};

type RawPoolAccountList = { items?: RawPoolAccount[]; accounts?: RawPoolAccount[]; total?: number };

export type PoolAccountQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  group?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: string;
};

/** Rich Sub2API account list for the pool-review dashboard (no `lite`). */
export async function listPoolAccounts(params: PoolAccountQuery): Promise<{ items: PoolAccount[]; total: number }> {
  const config = await getSub2ApiConfig();
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    page_size: String(params.pageSize ?? 20),
    platform: "anthropic",
    sort_by: params.sortBy || "created_at",
    sort_order: params.sortOrder === "asc" ? "asc" : "desc",
  });
  if (params.search) query.set("search", params.search);
  if (params.group) query.set("group", params.group);
  if (params.status) query.set("status", params.status);

  const result = await request<RawPoolAccountList | RawPoolAccount[]>(config, `/api/v1/admin/accounts?${query}`, {
    method: "GET",
  });
  const items = Array.isArray(result) ? result : result.items || result.accounts || [];

  return {
    items: items.map(summarizePoolAccount),
    total: Array.isArray(result) ? items.length : result.total ?? items.length,
  };
}

/** Aggregate pool metrics for the top strip. */
export async function getDashboardStats(): Promise<PoolStats> {
  const config = await getSub2ApiConfig();
  const data = await request<Record<string, unknown>>(config, "/api/v1/admin/dashboard/stats", { method: "GET" });
  return {
    totalAccounts: numberOf(data.total_accounts),
    normalAccounts: numberOf(data.normal_accounts),
    errorAccounts: numberOf(data.error_accounts),
    ratelimitAccounts: numberOf(data.ratelimit_accounts),
    overloadAccounts: numberOf(data.overload_accounts),
    todayCost: numberOf(data.today_cost),
    totalCost: numberOf(data.total_cost),
    todayRequests: numberOf(data.today_requests),
    rpm: numberOf(data.rpm),
    tpm: numberOf(data.tpm),
  };
}

function summarizePoolAccount(value: RawPoolAccount): PoolAccount {
  const extra = value.extra;
  const creds = value.credentials;
  const groups = Array.isArray(value.groups)
    ? value.groups.map((group) => (group && typeof group.name === "string" ? group.name : "")).filter(Boolean)
    : [];

  return {
    id: value.id ?? null,
    name: value.name ?? null,
    email: pickString(value.email_address, value.email, extra?.email_address, extra?.email, creds?.email, value.parent_email),
    platform: value.platform ?? "anthropic",
    type: value.type ?? "oauth",
    status: value.status ?? "active",
    schedulable: typeof value.schedulable === "boolean" ? value.schedulable : null,
    errorMessage: value.error_message ?? null,
    createdAt: value.created_at ?? null,
    lastUsedAt: value.last_used_at ?? null,
    subscription: pickString(creds?.plan_type, creds?.subscription_tier, value.subscription_type),
    groups,
    rateMultiplier: pickNumber(value.rate_multiplier),
    concurrency: pickNumber(value.concurrency),
    currentConcurrency: pickNumber(value.current_concurrency),
    baseRpm: pickNumber(value.base_rpm),
    currentRpm: pickNumber(value.current_rpm),
    windowCostLimit: pickNumber(value.window_cost_limit),
    currentWindowCost: pickNumber(value.current_window_cost),
    maxSessions: pickNumber(value.max_sessions),
    activeSessions: pickNumber(value.active_sessions),
    rateLimitResetAt: value.rate_limit_reset_at ?? value.rate_limited_at ?? null,
    overloadUntil: value.overload_until ?? null,
    tempUnschedulableUntil: value.temp_unschedulable_until ?? null,
    tempUnschedulableReason: value.temp_unschedulable_reason ?? null,
    sessionWindowEnd: value.session_window_end ?? null,
    sessionWindowStatus: value.session_window_status ?? null,
  };
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function pickNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

type GenerateAuthUrlResponse = {
  auth_url: string;
  session_id: string;
};

async function request<T>(
  config: Awaited<ReturnType<typeof getSub2ApiConfig>>,
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
    email: value?.email ?? value?.email_address ?? null,
    platform: value?.platform ?? "anthropic",
    type: value?.type ?? "oauth",
    status: value?.status ?? "active",
    schedulable: value?.schedulable ?? null,
    errorMessage: value?.error_message ?? null,
    createdAt: value?.created_at ?? null,
    displayName: value?.account_display_name ?? value?.display_name ?? null,
    subscription: value?.subscription_type ?? value?.subscription_tier ?? null,
    deadCause: value?.lifecycle_dead_cause ?? null,
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
