import type { CustomGateway } from "@/lib/account-store";
import { Sub2ApiError } from "@/lib/sub2api";
import type { PoolAccountSummary, PoolBackend } from "./types";

/**
 * Generic self-built gateway. It receives a Sub2API-shaped account payload at
 * config.url (POST) and, if config.listUrl is set, reads the pool from there
 * (GET). The gateway owner defines the contract, so this makes no
 * version-specific assumptions beyond the JSON payload shape below.
 */
export function customBackend(config: CustomGateway): PoolBackend {
  return {
    kind: "custom",
    label: config.name || "自建网关",

    async createClaudeAccount(input) {
      if (!config.url) {
        throw new Sub2ApiError("自建网关未配置地址（CUSTOM_BACKEND_URL）");
      }

      const data = await request(config, config.url, {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          notes: input.notes || undefined,
          platform: "anthropic",
          type: "oauth",
          credentials: input.tokenInfo,
          extra: compactExtra(input.tokenInfo),
          group_ids: input.groupIds ?? [],
        }),
      });

      const account = (data ?? {}) as { id?: number | string; status?: string };
      return {
        id: account.id ?? null,
        name: input.name,
        email: input.tokenInfo.email_address ?? null,
        platform: "anthropic",
        type: "oauth",
        status: account.status ?? "active",
        schedulable: null,
        errorMessage: null,
        createdAt: null,
        backend: "custom",
      } satisfies PoolAccountSummary;
    },

    async listClaudeAccounts() {
      if (!config.listUrl) {
        return { items: [], total: 0 };
      }

      const data = await request(config, config.listUrl, { method: "GET" });
      const rows = Array.isArray(data)
        ? data
        : Array.isArray((data as { items?: unknown })?.items)
          ? ((data as { items: unknown[] }).items)
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
        backend: "custom" as const,
      }));

      return { items, total: items.length };
    },
  };
}

async function request(config: CustomGateway, url: string, init: RequestInit) {
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
        ...init.headers,
      },
      cache: "no-store",
    });
  } catch {
    throw new Sub2ApiError("无法连接自建网关，请检查地址和网络");
  }

  const rawBody = await response.text();
  const payload = parseJson(rawBody);

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload && typeof (payload as { error: unknown }).error === "string"
        ? (payload as { error: string }).error
        : `自建网关请求失败（HTTP ${response.status}）`;
    throw new Sub2ApiError(message, response.status);
  }

  if (typeof payload === "object" && payload !== null && "data" in payload) {
    return (payload as { data: unknown }).data;
  }
  return payload;
}

function compactExtra(tokenInfo: { org_uuid?: string; account_uuid?: string; email_address?: string }) {
  return {
    ...(tokenInfo.org_uuid ? { org_uuid: tokenInfo.org_uuid } : {}),
    ...(tokenInfo.account_uuid ? { account_uuid: tokenInfo.account_uuid } : {}),
    ...(tokenInfo.email_address ? { email_address: tokenInfo.email_address } : {}),
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
