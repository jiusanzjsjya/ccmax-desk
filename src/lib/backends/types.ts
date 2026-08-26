import type { ClaudeTokenInfo, Sub2ApiAccountSummary } from "@/lib/sub2api";

export type { ClaudeTokenInfo };

/**
 * Neutral account summary returned to the browser. Shaped like Sub2API's
 * summary so the existing UI keeps working; `backend` records which target
 * pool the account was written to.
 */
export type PoolAccountSummary = Sub2ApiAccountSummary & { backend?: BackendKind };

export type CreateClaudeAccountInput = {
  name: string;
  notes?: string;
  tokenInfo: ClaudeTokenInfo;
  groupIds?: number[];
};

export type BackendKind = "sub2api" | "newapi" | "oneapi" | "custom";

/**
 * A target account pool / gateway that stores a finished Claude OAuth account.
 * Sub2API, new-api, one-api and self-built gateways each implement this.
 */
export interface PoolBackend {
  kind: BackendKind;
  label: string;
  createClaudeAccount(input: CreateClaudeAccountInput): Promise<PoolAccountSummary>;
  listClaudeAccounts(): Promise<{ items: PoolAccountSummary[]; total: number }>;
}

/**
 * Brokers the Claude OAuth handshake (authorize URL + code exchange). Kept
 * separate from PoolBackend because the destination pool and the OAuth broker
 * are not necessarily the same system. Today Sub2API is the only broker; a
 * native Claude provider can replace it later without touching PoolBackend.
 */
export interface OAuthBroker {
  generateClaudeAuthUrl(opts?: { proxyId?: number }): Promise<{ auth_url: string; session_id: string }>;
  exchangeClaudeCode(flow: { sessionId: string; code: string }): Promise<ClaudeTokenInfo>;
}
