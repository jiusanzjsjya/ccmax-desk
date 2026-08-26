import {
  createClaudeAccount,
  exchangeClaudeCode,
  generateClaudeAuthUrl,
  listClaudeAccounts,
} from "@/lib/sub2api";
import type { OAuthBroker, PoolBackend } from "./types";

/**
 * Sub2API as a target account pool. Behaviour is identical to the previous
 * hard-coded implementation — this only wraps it behind the PoolBackend seam.
 */
export const sub2apiBackend: PoolBackend = {
  kind: "sub2api",
  label: "Sub2API",
  createClaudeAccount: (input) =>
    createClaudeAccount(input).then((account) => ({ ...account, backend: "sub2api" as const })),
  listClaudeAccounts: async () => {
    const { items, total } = await listClaudeAccounts();
    return { items: items.map((account) => ({ ...account, backend: "sub2api" as const })), total };
  },
};

/**
 * Sub2API also brokers the Claude OAuth handshake (generate-auth-url +
 * exchange-code). This stays required even when the destination pool is
 * new-api / one-api / custom, because those backends do not perform Claude
 * OAuth themselves.
 */
export const sub2apiOAuthBroker: OAuthBroker = {
  generateClaudeAuthUrl: (opts) => generateClaudeAuthUrl(opts),
  exchangeClaudeCode: (flow) => exchangeClaudeCode(flow),
};
