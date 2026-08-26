import { Sub2ApiError } from "@/lib/sub2api";
import type { BackendKind, PoolAccountSummary, PoolBackend } from "./types";

/**
 * Shared client for one-api and its fork new-api. Both expose an OpenAI-style
 * channel-management API (`/api/channel`). A Claude account is stored as a
 * channel whose credential holds the OAuth token.
 *
 * VERSION-SENSITIVE: the numeric channel `type`, the model list, and — most
 * importantly — how a Claude *OAuth* token is encoded into the channel `key`
 * differ across one-api / new-api versions. `channelType` and `models` are
 * therefore env-driven, and the key encoding below is the documented default
 * that must be verified against the target deployment before production use.
 */
export type RelayConfig = {
  kind: BackendKind;
  label: string;
  baseUrl: string;
  adminToken: string;
  /** new-api requires a numeric user id sent via the `New-Api-User` header. */
  userId?: string;
  /** Provider code for Claude/Anthropic (one-api default is 14). */
  channelType: number;
  /** Comma-separated model list advertised by the channel. */
  models: string;
};

type RelayEnvelope = { success?: boolean; message?: string; data?: unknown };

export function createRelayBackend(config: RelayConfig): PoolBackend {
  return {
    kind: config.kind,
    label: config.label,

    async createClaudeAccount(input) {
      const data = await request(config, "/api/channel/", {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          type: config.channelType,
          // NOTE: verify the Claude-OAuth key encoding for your one-api/new-api version.
          key: input.tokenInfo.access_token,
          base_url: "",
          models: config.models,
          group: "default",
          groups: ["default"],
        }),
      });

      const channel = (data ?? {}) as { id?: number | string };
      return {
        id: channel.id ?? null,
        name: input.name,
        email: input.tokenInfo.email_address ?? null,
        platform: "anthropic",
        type: "oauth",
        status: "active",
        schedulable: null,
        errorMessage: null,
        createdAt: null,
        backend: config.kind,
      } satisfies PoolAccountSummary;
    },

    async listClaudeAccounts() {
      const query = new URLSearchParams({ p: "1", page_size: "50" });
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
