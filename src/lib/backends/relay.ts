import { Sub2ApiError } from "@/lib/sub2api";
import type { BackendKind, PoolAccountSummary, PoolBackend } from "./types";

/**
 * Shared client for one-api and its fork new-api. Both expose an admin
 * channel-management API (`POST /api/channel/`, `GET /api/channel/`).
 *
 * VERIFIED against source (one-api v0.6.9 `36c8f4f`, new-api v1.0.0-rc.26
 * `8f6961c`): the Anthropic channel `type` is 14 and its `key` is a STATIC
 * Anthropic API key (`sk-ant-...`), sent upstream as the `x-api-key` header.
 * Neither platform accepts a Claude OAuth token (access_token/refresh_token/
 * expiry) for the Anthropic type — new-api's OAuth storage+refresh exists only
 * for Codex/type 57 (ChatGPT), with no Claude analog. We therefore store the
 * operator's configured static `apiKey`, NOT the Claude OAuth token, and require
 * it up front.
 *
 * Request shape differs: new-api wraps the channel as `{mode:"single",
 * channel:{…}}`; one-api posts the channel flat. Both auth with
 * `Authorization: Bearer <adminToken>` (the `New-Api-User` header is optional/
 * legacy). `channelType`/`models` stay configurable across deployments.
 */
export type RelayConfig = {
  kind: BackendKind;
  label: string;
  baseUrl: string;
  /** Admin API token (Authorization: Bearer) used to create/list channels. */
  adminToken: string;
  /** Optional/legacy numeric user id sent via the `New-Api-User` header. */
  userId?: string;
  /** Provider code for Claude/Anthropic (14 on both one-api and new-api). */
  channelType: number;
  /** Comma-separated model list advertised by the channel. */
  models: string;
  /** Static Anthropic API key (sk-ant-...) written to the channel `key`. */
  apiKey: string;
};

type RelayEnvelope = { success?: boolean; message?: string; data?: unknown };

export function createRelayBackend(config: RelayConfig): PoolBackend {
  return {
    kind: config.kind,
    label: config.label,

    async createClaudeAccount(input) {
      if (!config.apiKey) {
        throw new Sub2ApiError(
          `${config.label} 的 Anthropic 渠道只接受静态 Anthropic API Key（sk-ant-...），` +
            `请在超管后台该平台配置里填写 API Key；Claude OAuth 账号无法直接写入该渠道。`,
        );
      }

      // Anthropic channel (type 14): `key` is the static Anthropic API key, sent
      // upstream as x-api-key. The Claude OAuth token cannot be stored here.
      const channelBody = {
        name: input.name,
        type: config.channelType,
        key: config.apiKey,
        base_url: "",
        models: config.models,
        group: "default",
      };
      // new-api wraps the channel in {mode, channel}; one-api posts it flat.
      const body = config.kind === "newapi" ? { mode: "single", channel: channelBody } : channelBody;

      const data = await request(config, "/api/channel/", { method: "POST", body: JSON.stringify(body) });

      const channel = (data ?? {}) as { id?: number | string };
      return {
        id: channel.id ?? null,
        name: input.name,
        // For reference only: the created channel is keyed by a static API key,
        // not by this Claude account's OAuth credential.
        email: input.tokenInfo.email_address ?? null,
        platform: "anthropic",
        type: "apikey",
        status: "active",
        schedulable: null,
        errorMessage: null,
        createdAt: null,
        backend: config.kind,
      } satisfies PoolAccountSummary;
    },

    async listClaudeAccounts() {
      // one-api: `p` is 0-based, no page_size. new-api: `p` 1-based + page_size.
      const query =
        config.kind === "newapi"
          ? new URLSearchParams({ p: "1", page_size: "100" })
          : new URLSearchParams({ p: "0" });
      const data = await request(config, `/api/channel/?${query}`, { method: "GET" });
      const rows = extractRows(data);

      return {
        items: rows.map((row) => summarizeChannel(row, config.kind)),
        total: rows.length,
      };
    },
  };
}

async function request(config: RelayConfig, path: string, init: RequestInit) {
  let response: Response;

  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.adminToken}`,
        ...(config.userId ? { "New-Api-User": config.userId } : {}),
        ...init.headers,
      },
      cache: "no-store",
    });
  } catch {
    throw new Sub2ApiError(`无法连接 ${config.label}，请检查地址和网络`);
  }

  const rawBody = await response.text();
  const payload = parseJson(rawBody);

  if (!response.ok) {
    throw new Sub2ApiError(readMessage(payload) ?? `${config.label} 请求失败（HTTP ${response.status}）`, response.status);
  }

  if (isEnvelope(payload)) {
    if (payload.success === false) {
      throw new Sub2ApiError(payload.message || `${config.label} 返回业务错误`, response.status);
    }
    return payload.data;
  }

  return payload;
}

function extractRows(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data as Array<Record<string, unknown>>;
  if (data && typeof data === "object") {
    const records = data as { items?: unknown; records?: unknown };
    const list = Array.isArray(records.items) ? records.items : Array.isArray(records.records) ? records.records : [];
    return list as Array<Record<string, unknown>>;
  }
  return [];
}

function summarizeChannel(row: Record<string, unknown>, backend: BackendKind): PoolAccountSummary {
  const status = row.status === 1 || row.status === undefined ? "active" : String(row.status);
  return {
    id: (row.id as number | string) ?? null,
    name: (row.name as string) ?? null,
    email: null,
    platform: "anthropic",
    type: "oauth",
    status,
    schedulable: null,
    errorMessage: (row.response as string) ?? null,
    createdAt: null,
    backend,
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function isEnvelope(value: unknown): value is RelayEnvelope {
  return typeof value === "object" && value !== null && ("success" in value || "data" in value);
}

function readMessage(value: unknown) {
  if (typeof value === "object" && value !== null && "message" in value && typeof (value as RelayEnvelope).message === "string") {
    return (value as RelayEnvelope).message ?? null;
  }
  if (typeof value === "string" && value.trim()) {
    return value.slice(0, 300);
  }
  return null;
}
