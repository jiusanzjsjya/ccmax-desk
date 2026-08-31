import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import path from "node:path";

import { env } from "@/lib/env";
import type { Role } from "@/lib/roles";
import { ccgatewayIdFromRef, ccgatewayRef, customIdFromRef, customRef, refKind, sub2gwIdFromRef, sub2gwRef, type BackendRef } from "@/lib/backends/kinds";
import { encryptSecret } from "@/lib/secret-box";

/**
 * Provisioning modules a non-superadmin account may be granted. Each is an
 * independent authorization, controlled by the superadmin:
 * - "onboard": 授权上号 — Claude OAuth onboarding (the original flow).
 * - "key":     授权上key — upload an OpenAI upstream account by API key.
 * A module absent from an account's `allowedModules` is denied (no upload, and
 * its nav entry is hidden). The superadmin implicitly has every module.
 */
export type ProvisioningModule = "onboard" | "key";
export const PROVISIONING_MODULES: ProvisioningModule[] = ["onboard", "key"];

export type LocalAccount = {
  id: string;
  username: string;
  displayName: string;
  role: Exclude<Role, "superadmin">;
  /**
   * Superadmin-assigned target platform this account onboards on and reviews the
   * pool of. `null` = unassigned; onboarding and pool access are blocked until a
   * superadmin assigns one. Admin-created users snapshot their admin's value.
   */
  targetBackend: BackendRef | null;
  /**
   * Provisioning modules this account is authorized to use. Default-deny: a
   * module not listed here is blocked. Existing accounts are grandfathered into
   * `["onboard"]` by {@link normalizeAccount}; "key" is always opt-in.
   */
  allowedModules: ProvisioningModule[];
  passwordHash: string;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  lastLoginAt: string | null;
};

export type PublicAccount = Omit<LocalAccount, "passwordHash">;

export type SystemSettings = {
  provisioningEnabled: boolean;
  allowAdminCreateUsers: boolean;
  allowUserProvisioning: boolean;
  /** Master switch for the data-analysis / settlement-ledger module. */
  settlementModuleEnabled: boolean;
  /** When true, a `user` may choose the target platform; otherwise they are locked to the default backend. */
  allowUserSelectBackend: boolean;
  /** When true, a `user` may record their own settlement/prepay ledger entries. */
  allowUserLedgerWrite: boolean;
  /** When true, onboarding requires picking a prefix that is prepended to the batch note. */
  forcedPrefixEnabled: boolean;
  /** When true, onboarding requires selecting a CCMax egress proxy (local bookkeeping). */
  forcedProxyEnabled: boolean;
  /** Master switch for the built-in OpenAI-key monitor (auto-disables dead/erroring keys). */
  openaiKeyMonitorEnabled: boolean;
  /** How often the monitor scans, in minutes. */
  openaiKeyMonitorIntervalMinutes: number;
  /** Consecutive unhealthy scans before a key is auto-disabled (1 = immediate). */
  openaiKeyMonitorThreshold: number;
};

/**
 * A reusable onboarding prefix. When the `forcedPrefixEnabled` switch is on, a
 * prefix must be selected while onboarding and is prepended to the batch note.
 * Superadmin/admin manage the list; regular users can only select.
 */
export type AccountPrefix = {
  id: string;
  /** The prefix text prepended to the batch note (e.g. "Allen"). */
  value: string;
  createdBy: string;
  createdByName: string;
  createdByRole: Role;
  createdAt: string;
  updatedAt: string;
};

/** A settlement (结算) pays down accrued usage; a prepay (预付) is a top-up that offsets future usage. */
export type LedgerEntryKind = "settlement" | "prepay";

/**
 * A manual settlement / prepay bookkeeping record. Amounts are text-only
 * bookkeeping figures — nothing here touches a real payment gateway.
 */
export type LedgerEntry = {
  id: string;
  /** CCMax user this entry belongs to (a local account id or "env-superadmin"). */
  userId: string;
  /** Username snapshot for display, independent of later renames/deletes. */
  username: string;
  kind: LedgerEntryKind;
  /** Ledger amount recorded for this entry, in USD. */
  amountUsd: number;
  /** Real amount actually paid (recorded for reference only). */
  paidAmount: number | null;
  /** Currency of the real payment (recorded for reference only, e.g. USD/CNY). */
  paidCurrency: string;
  note: string | null;
  createdAt: string;
  createdBy: string;
  createdByName: string;
};

/**
 * Attribution record: which CCMax user onboarded a given backend account.
 * Keyed by (platform ref, stringified account id). Sub2API accounts carry no
 * CCMax identity, so this local map is the source of truth for per-user scoping.
 */
export type PoolOwnership = {
  platform: BackendRef;
  accountId: string;
  ownerId: string;
  ownerUsername: string;
  /** CCMax egress proxy this account was onboarded with (local bookkeeping only). */
  proxyId?: string;
  createdAt: string;
};

/** VERIFIED protocol set (mirrors Sub2API's proxy enum). */
export type EgressProxyProtocol = "http" | "https" | "socks5" | "socks5h";

/**
 * A CCMax-local egress proxy. Purely a bookkeeping/selection aid: CCMax stores
 * the proxy and tracks how many accounts were onboarded with it — it does NOT
 * route traffic or push the proxy to any backend. `password` is AES-encrypted.
 */
export type EgressProxy = {
  id: string;
  ownerId: string;
  ownerName: string;
  label: string;
  protocol: EgressProxyProtocol;
  host: string;
  port: number;
  username: string;
  /** AES-encrypted at rest (`enc:v1:…`). */
  password: string;
  createdAt: string;
};

export type AuditEvent = {
  id: string;
  actorId: string;
  actorName: string;
  actorRole: Role;
  action: string;
  targetId?: string;
  details?: string;
  createdAt: string;
};

export type Sub2ApiBackendConfig = { baseUrl: string; adminToken: string; proxyId: number | null };
export type RelayBackendConfig = {
  baseUrl: string;
  /** Authenticates the new-api/one-api admin API (Authorization: Bearer) to create channels. */
  adminToken: string;
  userId: string;
  channelType: number;
  models: string;
  /**
   * Static Anthropic API key (sk-ant-...) stored in the created channel's `key`.
   * new-api/one-api Anthropic channels only accept a static key — a Claude OAuth
   * token cannot be used, so this is required to create a usable channel.
   */
  apiKey: string;
};
/** Connection fields of one self-built gateway (legacy single-gateway shape). */
export type CustomBackendConfig = { url: string; token: string; listUrl: string };
/** One self-built gateway. `id` makes multiple gateways individually addressable. */
export type CustomGateway = CustomBackendConfig & { id: string; name: string };

/** Superadmin-editable multi-platform backend configuration (persisted). */
export type BackendConfigStore = {
  defaultBackend: BackendRef;
  enabled: BackendRef[];
  sub2api: Sub2ApiBackendConfig;
  newapi: RelayBackendConfig;
  oneapi: Omit<RelayBackendConfig, "userId">;
  customs: CustomGateway[];
  ccgateways: CcGateway[];
  sub2gws: Sub2Gw[];
};

/**
 * Per-key health tracking for the OpenAI-key monitor. Keyed by (platform ref,
 * accountId). `consecutiveErrors` counts unhealthy scans in a row (reset to 0 on
 * a healthy scan); `disabledByMonitor` marks a key the monitor auto-disabled.
 */
export type KeyHealthState = {
  platform: BackendRef;
  accountId: string;
  consecutiveErrors: number;
  disabledByMonitor: boolean;
  lastCheckedAt: string;
};

export type LocalAccountStore = {
  accounts: LocalAccount[];
  settings: SystemSettings;
  audit: AuditEvent[];
  backends: BackendConfigStore;
  poolOwnership: PoolOwnership[];
  ledger: LedgerEntry[];
  accountPrefixes: AccountPrefix[];
  egressProxies: EgressProxy[];
  keyHealthStates: KeyHealthState[];
};

const defaultSettings: SystemSettings = {
  provisioningEnabled: true,
  allowAdminCreateUsers: true,
  allowUserProvisioning: true,
  settlementModuleEnabled: true,
  // Regular users may pick the target platform by default; superadmin can revoke it.
  // Ledger writing stays off until explicitly granted.
  allowUserSelectBackend: true,
  allowUserLedgerWrite: false,
  // Off by default: turning it on immediately blocks onboarding until a prefix is chosen.
  forcedPrefixEnabled: false,
  // Off by default: turning it on requires an egress proxy to be selected before onboarding.
  forcedProxyEnabled: false,
  // Off by default: auto-disabling keys is consequential, so the superadmin opts in.
  openaiKeyMonitorEnabled: false,
  openaiKeyMonitorIntervalMinutes: 5,
  openaiKeyMonitorThreshold: 1,
};

/** The connection/config-bearing slice of the backend store used for checks. */
type BackendConfigFields = Pick<BackendConfigStore, "sub2api" | "newapi" | "oneapi" | "customs" | "ccgateways" | "sub2gws">;

/** Singleton (non-custom) backend kinds; custom gateways are addressed by ref. */
const SINGLETON_KINDS = ["sub2api", "newapi", "oneapi"] as const;

/** Seed backend config from env on first run; the store is authoritative after. */
function defaultBackendConfig(): BackendConfigStore {
  const customs: CustomGateway[] = env.CUSTOM_BACKEND_URL
    ? [
        {
          id: randomUUID(),
          name: "自建网关",
          url: env.CUSTOM_BACKEND_URL,
          token: env.CUSTOM_BACKEND_TOKEN,
          listUrl: env.CUSTOM_BACKEND_LIST_URL,
        },
      ]
    : [];

  const config: BackendConfigFields = {
    ccgateways: [],
    sub2gws: [],
    sub2api: { baseUrl: env.SUB2API_BASE_URL, adminToken: env.SUB2API_ADMIN_TOKEN, proxyId: env.SUB2API_PROXY_ID ?? null },
    newapi: {
      baseUrl: env.NEWAPI_BASE_URL,
      adminToken: env.NEWAPI_ADMIN_TOKEN,
      userId: env.NEWAPI_USER_ID,
      channelType: env.NEWAPI_CHANNEL_TYPE,
      models: env.NEWAPI_MODELS,
      apiKey: env.NEWAPI_ANTHROPIC_API_KEY,
    },
    oneapi: {
      baseUrl: env.ONEAPI_BASE_URL,
      adminToken: env.ONEAPI_ADMIN_TOKEN,
      channelType: env.ONEAPI_CHANNEL_TYPE,
      models: env.ONEAPI_MODELS,
      apiKey: env.ONEAPI_ANTHROPIC_API_KEY,
    },
    customs,
  };

  // env.BACKEND_KIND is a kind; a "custom" seed maps to the seeded gateway ref.
  const defaultBackend: BackendRef =
    env.BACKEND_KIND === "custom" ? (customs[0] ? customRef(customs[0].id) : "sub2api") : env.BACKEND_KIND;

  const enabled = configuredRefs(config);
  return { ...config, defaultBackend, enabled: enabled.length ? enabled : ["sub2api"] };
}

/** True when the target a ref points at has the minimum fields to be usable. */
export function isBackendRefConfigured(ref: BackendRef, config: BackendConfigFields) {
  switch (refKind(ref)) {
    case "sub2api":
      return Boolean(config.sub2api.baseUrl && config.sub2api.adminToken);
    case "newapi":
      return Boolean(config.newapi.baseUrl && config.newapi.adminToken && config.newapi.apiKey);
    case "oneapi":
      return Boolean(config.oneapi.baseUrl && config.oneapi.adminToken && config.oneapi.apiKey);
    case "custom": {
      const id = customIdFromRef(ref);
      const gateway = id ? config.customs.find((item) => item.id === id) : undefined;
      return Boolean(gateway?.url);
    }
    case "ccgateway": {
      const id = ccgatewayIdFromRef(ref);
      const gateway = id ? config.ccgateways.find((item) => item.id === id) : undefined;
      return Boolean(gateway?.baseUrl && gateway.vendorEmail && gateway.vendorPassword);
    }
    case "sub2gw": {
      const id = sub2gwIdFromRef(ref);
      const gateway = id ? config.sub2gws.find((item) => item.id === id) : undefined;
      return Boolean(gateway?.baseUrl && gateway.adminEmail && gateway.adminPassword);
    }
    default:
      return false;
  }
}

/** All refs (singletons + gateways) that are currently configured. */
function configuredRefs(config: BackendConfigFields): BackendRef[] {
  const refs: BackendRef[] = SINGLETON_KINDS.filter((kind) => isBackendRefConfigured(kind, config));
  for (const gateway of config.customs) {
    const ref = customRef(gateway.id);
    if (isBackendRefConfigured(ref, config)) refs.push(ref);
  }
  for (const gateway of config.ccgateways) {
    const ref = ccgatewayRef(gateway.id);
    if (isBackendRefConfigured(ref, config)) refs.push(ref);
  }
  for (const gateway of config.sub2gws) {
    const ref = sub2gwRef(gateway.id);
    if (isBackendRefConfigured(ref, config)) refs.push(ref);
  }
  return refs;
}

/** The set of refs that exist at all (singletons + defined gateways), configured or not. */
function knownRefs(customs: CustomGateway[], ccgateways: CcGateway[], sub2gws: Sub2Gw[]): Set<BackendRef> {
  return new Set<BackendRef>([
    ...SINGLETON_KINDS,
    ...customs.map((gateway) => customRef(gateway.id)),
    ...ccgateways.map((gateway) => ccgatewayRef(gateway.id)),
    ...sub2gws.map((gateway) => sub2gwRef(gateway.id)),
  ]);
}

export async function getAccountStore(): Promise<LocalAccountStore> {
  try {
    const content = await readFile(getStorePath(), "utf8");
    return normalizeStore(JSON.parse(content) as Partial<LocalAccountStore>);
  } catch (error) {
    if (isFileMissing(error)) {
      return emptyStore();
    }

    throw new Error("本地账号存储文件无法读取");
  }
}

export async function createLocalAccount(input: {
  username: string;
  displayName: string;
  password: string;
  role: Exclude<Role, "superadmin">;
  createdBy: string;
  targetBackend?: BackendRef | null;
  allowedModules?: ProvisioningModule[];
}) {
  return mutateStore((store) => {
    const username = normalizeUsername(input.username);
    if (store.accounts.some((account) => account.username === username)) {
      throw new AccountStoreError("该登录名已存在", "duplicate_username");
    }

    const now = new Date().toISOString();
    const account: LocalAccount = {
      id: randomUUID(),
      username,
      displayName: input.displayName.trim() || username,
      role: input.role,
      targetBackend: input.targetBackend ?? null,
      allowedModules: sanitizeModules(input.allowedModules ?? ["onboard"]),
      passwordHash: hashPassword(input.password),
      disabled: false,
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
      lastLoginAt: null,
    };

    store.accounts.unshift(account);
    return account;
  });
}

export async function findLocalAccount(username: string) {
  const store = await getAccountStore();
  return store.accounts.find((account) => account.username === normalizeUsername(username)) ?? null;
}

export async function findLocalAccountById(accountId: string) {
  const store = await getAccountStore();
  return store.accounts.find((account) => account.id === accountId) ?? null;
}

export function verifyPassword(password: string, passwordHash: string) {
  const [salt, expectedHex] = passwordHash.split(":");
  if (!salt || !expectedHex) return false;

  try {
    const expected = Buffer.from(expectedHex, "hex");
    const received = scryptSync(password, salt, expected.length);
    return expected.length === received.length && timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

export async function markAccountLogin(accountId: string) {
  return mutateStore((store) => {
    const account = store.accounts.find((item) => item.id === accountId);
    if (!account) return null;

    const now = new Date().toISOString();
    account.lastLoginAt = now;
    account.updatedAt = now;
    return account;
  });
}

export async function updateLocalAccount(
  accountId: string,
  input: {
    role?: Exclude<Role, "superadmin">;
    disabled?: boolean;
    displayName?: string;
    targetBackend?: BackendRef | null;
    allowedModules?: ProvisioningModule[];
  },
) {
  return mutateStore((store) => {
    const account = store.accounts.find((item) => item.id === accountId);
    if (!account) return null;

    if (input.role) account.role = input.role;
    if (typeof input.disabled === "boolean") account.disabled = input.disabled;
    if (typeof input.displayName === "string" && input.displayName.trim()) {
      account.displayName = input.displayName.trim();
    }
    // `null` unassigns; `undefined` leaves it untouched.
    if (input.targetBackend !== undefined) account.targetBackend = input.targetBackend;
    if (input.allowedModules !== undefined) account.allowedModules = sanitizeModules(input.allowedModules);
    account.updatedAt = new Date().toISOString();
    return account;
  });
}

export async function deleteLocalAccount(accountId: string) {
  return mutateStore((store) => {
    const index = store.accounts.findIndex((item) => item.id === accountId);
    if (index < 0) return null;
    const [account] = store.accounts.splice(index, 1);
    return account;
  });
}

export async function updateLocalPassword(accountId: string, password: string) {
  return mutateStore((store) => {
    const account = store.accounts.find((item) => item.id === accountId);
    if (!account) return null;

    account.passwordHash = hashPassword(password);
    account.updatedAt = new Date().toISOString();
    return account;
  });
}

export async function updateSystemSettings(patch: Partial<SystemSettings>) {
  return mutateStore((store) => {
    store.settings = { ...store.settings, ...patch };
    return store.settings;
  });
}

/**
 * Fold one monitor scan's observations into the per-key health counters and
 * return the accountIds that just crossed the disable threshold (and are not yet
 * monitor-disabled). Healthy scans reset a key's streak; zeroed, non-disabled
 * entries are pruned so the store stays small.
 */
export async function reconcileKeyHealth(
  platform: BackendRef,
  observations: Array<{ accountId: string; healthy: boolean }>,
  threshold: number,
): Promise<string[]> {
  return mutateStore((store) => {
    const now = new Date().toISOString();
    const toDisable: string[] = [];
    const byId = new Map(
      store.keyHealthStates.filter((state) => state.platform === platform).map((state) => [state.accountId, state] as const),
    );

    for (const obs of observations) {
      const existing = byId.get(obs.accountId);
      if (obs.healthy) {
        if (existing) {
          existing.consecutiveErrors = 0;
          existing.lastCheckedAt = now;
        }
        continue;
      }
      const state =
        existing ??
        (() => {
          const created: KeyHealthState = { platform, accountId: obs.accountId, consecutiveErrors: 0, disabledByMonitor: false, lastCheckedAt: now };
          store.keyHealthStates.push(created);
          byId.set(obs.accountId, created);
          return created;
        })();
      state.consecutiveErrors += 1;
      state.lastCheckedAt = now;
      if (!state.disabledByMonitor && state.consecutiveErrors >= Math.max(1, threshold)) {
        toDisable.push(obs.accountId);
      }
    }

    store.keyHealthStates = store.keyHealthStates.filter((state) => state.consecutiveErrors > 0 || state.disabledByMonitor);
    return toDisable;
  });
}

/** Mark keys as auto-disabled by the monitor (after the Sub2API disable succeeds). */
export async function markKeysDisabledByMonitor(platform: BackendRef, accountIds: string[]) {
  if (!accountIds.length) return;
  return mutateStore((store) => {
    const set = new Set(accountIds);
    for (const state of store.keyHealthStates) {
      if (state.platform === platform && set.has(state.accountId)) state.disabledByMonitor = true;
    }
    return null;
  });
}

/**
 * Record who onboarded a backend account. Deduped on (platform, accountId) and
 * keep-first: a later onboard of the same id can never silently reassign owner.
 */
export async function recordPoolOwnership(entry: PoolOwnership) {
  return mutateStore((store) => {
    const exists = store.poolOwnership.some(
      (item) => item.platform === entry.platform && item.accountId === entry.accountId,
    );
    if (!exists) store.poolOwnership.push(entry);
    return entry;
  });
}

/** Stringified account ids on a platform that belong to a given owner. */
export async function listOwnedAccountIds(platform: BackendRef, ownerId: string): Promise<Set<string>> {
  const store = await getAccountStore();
  const owned = new Set<string>();
  for (const item of store.poolOwnership) {
    if (item.platform === platform && item.ownerId === ownerId) owned.add(item.accountId);
  }
  return owned;
}

/** All settlement/prepay ledger entries, newest first. */
export async function listLedgerEntries(): Promise<LedgerEntry[]> {
  const store = await getAccountStore();
  return store.ledger;
}

/** Append a settlement/prepay entry (bookkeeping only — no payment side effects). */
export async function addLedgerEntry(input: Omit<LedgerEntry, "id" | "createdAt">) {
  return mutateStore((store) => {
    const entry: LedgerEntry = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    store.ledger.unshift(entry);
    return entry;
  });
}

/** Remove a ledger entry by id. Returns the removed entry, or null if not found. */
export async function deleteLedgerEntry(id: string) {
  return mutateStore((store) => {
    const index = store.ledger.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const [entry] = store.ledger.splice(index, 1);
    return entry;
  });
}

/** All onboarding prefixes, newest first. */
export async function listAccountPrefixes(): Promise<AccountPrefix[]> {
  const store = await getAccountStore();
  return store.accountPrefixes;
}

/** Append a prefix. Returns null if an identical value already exists (case-insensitive). */
export async function addAccountPrefix(input: Pick<AccountPrefix, "value" | "createdBy" | "createdByName" | "createdByRole">) {
  return mutateStore((store) => {
    const value = input.value.trim();
    if (!value) return null;
    const duplicate = store.accountPrefixes.some((item) => item.value.toLowerCase() === value.toLowerCase());
    if (duplicate) return null;
    const now = new Date().toISOString();
    const entry: AccountPrefix = {
      id: randomUUID(),
      value,
      createdBy: input.createdBy,
      createdByName: input.createdByName,
      createdByRole: input.createdByRole,
      createdAt: now,
      updatedAt: now,
    };
    store.accountPrefixes.unshift(entry);
    return entry;
  });
}

/** Rename a prefix by id. Returns null if not found, "" value, or a duplicate. */
export async function updateAccountPrefix(id: string, value: string) {
  return mutateStore((store) => {
    const next = value.trim();
    if (!next) return null;
    const entry = store.accountPrefixes.find((item) => item.id === id);
    if (!entry) return null;
    const duplicate = store.accountPrefixes.some(
      (item) => item.id !== id && item.value.toLowerCase() === next.toLowerCase(),
    );
    if (duplicate) return null;
    entry.value = next;
    entry.updatedAt = new Date().toISOString();
    return entry;
  });
}

/** Remove a prefix by id. Returns the removed entry, or null if not found. */
export async function deleteAccountPrefix(id: string) {
  return mutateStore((store) => {
    const index = store.accountPrefixes.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const [entry] = store.accountPrefixes.splice(index, 1);
    return entry;
  });
}

/** All egress proxies, newest first. */
export async function listEgressProxies(): Promise<EgressProxy[]> {
  const store = await getAccountStore();
  return store.egressProxies;
}

export type NewEgressProxy = {
  label?: string;
  protocol: EgressProxyProtocol;
  host: string;
  port: number;
  username?: string;
  password?: string;
};

/** Stable identity of a proxy for per-owner dedupe (ignores label/password). */
function egressProxyKey(p: { protocol: string; host: string; port: number; username: string }) {
  return `${p.protocol}://${p.username}@${p.host}:${p.port}`.toLowerCase();
}

/**
 * Append egress proxies for an owner, encrypting passwords. Dedupes identical
 * (protocol/host/port/username) entries the owner already has. Returns those
 * actually added (so the caller can report "added N, skipped M").
 */
export async function addEgressProxies(ownerId: string, ownerName: string, inputs: NewEgressProxy[]) {
  return mutateStore((store) => {
    const seen = new Set(store.egressProxies.filter((p) => p.ownerId === ownerId).map(egressProxyKey));
    const now = new Date().toISOString();
    const added: EgressProxy[] = [];
    for (const input of inputs) {
      const proxy: EgressProxy = {
        id: randomUUID(),
        ownerId,
        ownerName,
        label: (input.label ?? "").trim(),
        protocol: input.protocol,
        host: input.host.trim(),
        port: input.port,
        username: (input.username ?? "").trim(),
        password: input.password ? encryptSecret(input.password) : "",
        createdAt: now,
      };
      const key = egressProxyKey(proxy);
      if (seen.has(key)) continue;
      seen.add(key);
      store.egressProxies.unshift(proxy);
      added.push(proxy);
    }
    return added;
  });
}

/** Delete an egress proxy by id. Returns the removed proxy, or null if not found. */
export async function deleteEgressProxy(id: string) {
  return mutateStore((store) => {
    const index = store.egressProxies.findIndex((p) => p.id === id);
    if (index < 0) return null;
    const [proxy] = store.egressProxies.splice(index, 1);
    return proxy;
  });
}

/** How many onboarded accounts are bound to each egress proxy (id -> count). */
export async function countAccountsByProxy(): Promise<Record<string, number>> {
  const store = await getAccountStore();
  const counts: Record<string, number> = {};
  for (const owner of store.poolOwnership) {
    if (owner.proxyId) counts[owner.proxyId] = (counts[owner.proxyId] ?? 0) + 1;
  }
  return counts;
}

/**
 * One "Claude Gateway" (vendor) instance. Unlike a generic custom gateway, this
 * one is driven by a vendor login: the adapter mints a short-lived JWT from
 * `vendorEmail`/`vendorPassword`, then imports the finished Claude account by
 * refresh token. `vendorPassword` is stored AES-encrypted (see lib/secret-box).
 */
export type CcGateway = {
  id: string;
  name: string;
  baseUrl: string;
  vendorEmail: string;
  /** AES-encrypted at rest (`enc:v1:…`); decrypted only inside the adapter. */
  vendorPassword: string;
  /** Target group id on the gateway; blank = auto-use the gateway's default group. */
  groupId: string;
};

/**
 * One password-auth Sub2API instance. Same Sub2API software/endpoints as the
 * primary `sub2api` backend, but authenticated by an admin account login
 * (email/password → short-lived JWT) instead of a long-lived admin API key. Used
 * mainly as a target for OpenAI 上key. `adminPassword` is AES-encrypted at rest.
 */
export type Sub2Gw = {
  id: string;
  name: string;
  baseUrl: string;
  adminEmail: string;
  /** AES-encrypted at rest (`enc:v1:…`); decrypted only inside the adapter. */
  adminPassword: string;
};

/** One gateway in a PATCH: `id` present = edit existing (blank token keeps stored). */
export type CustomGatewayPatch = { id?: string; name?: string; url?: string; token?: string; listUrl?: string };

/** One ccgateway in a PATCH: blank `vendorPassword` keeps the stored (encrypted) one. */
export type CcGatewayPatch = { id?: string; name?: string; baseUrl?: string; vendorEmail?: string; vendorPassword?: string; groupId?: string };

/** One sub2gw in a PATCH: blank `adminPassword` keeps the stored (encrypted) one. */
export type Sub2GwPatch = { id?: string; name?: string; baseUrl?: string; adminEmail?: string; adminPassword?: string };

export type BackendConfigPatch = {
  defaultBackend?: BackendRef;
  enabled?: BackendRef[];
  sub2api?: Partial<Sub2ApiBackendConfig>;
  newapi?: Partial<RelayBackendConfig>;
  oneapi?: Partial<Omit<RelayBackendConfig, "userId">>;
  customs?: CustomGatewayPatch[];
  ccgateways?: CcGatewayPatch[];
  sub2gws?: Sub2GwPatch[];
};

export async function getBackendConfigStore() {
  const store = await getAccountStore();
  return store.backends;
}

export async function updateBackendSettings(patch: BackendConfigPatch) {
  return mutateStore((store) => {
    const backends = store.backends;
    if (patch.sub2api) backends.sub2api = { ...backends.sub2api, ...patch.sub2api };
    if (patch.newapi) backends.newapi = { ...backends.newapi, ...patch.newapi };
    if (patch.oneapi) backends.oneapi = { ...backends.oneapi, ...patch.oneapi };
    // Client submits the whole gateway list; merge by id so removed ones drop out.
    if (patch.customs) backends.customs = mergeCustomGateways(backends.customs, patch.customs);
    if (patch.ccgateways) backends.ccgateways = mergeCcGateways(backends.ccgateways, patch.ccgateways);
    if (patch.sub2gws) backends.sub2gws = mergeSub2Gws(backends.sub2gws, patch.sub2gws);

    // enabled / default may point at gateways; keep them valid against the current set.
    const known = knownRefs(backends.customs, backends.ccgateways, backends.sub2gws);
    const nextEnabled = patch.enabled ?? backends.enabled;
    backends.enabled = nextEnabled.filter((ref) => known.has(ref));
    if (patch.defaultBackend && known.has(patch.defaultBackend)) backends.defaultBackend = patch.defaultBackend;
    if (!known.has(backends.defaultBackend)) backends.defaultBackend = backends.enabled[0] ?? "sub2api";

    return backends;
  });
}

/** Merge an incoming gateway list into the stored one, preserving blank-token secrets. */
function mergeCustomGateways(existing: CustomGateway[], incoming: CustomGatewayPatch[]): CustomGateway[] {
  const byId = new Map(existing.map((gateway) => [gateway.id, gateway]));
  return incoming.map((patch) => {
    const prev = patch.id ? byId.get(patch.id) : undefined;
    return {
      id: patch.id || randomUUID(),
      name: ((patch.name ?? prev?.name ?? "").trim()) || "自建网关",
      url: (patch.url ?? prev?.url ?? "").trim(),
      // Blank token means "unchanged" for an existing gateway.
      token: patch.token !== undefined && patch.token !== "" ? patch.token : prev?.token ?? "",
      listUrl: (patch.listUrl ?? prev?.listUrl ?? "").trim(),
    };
  });
}

/**
 * Merge an incoming ccgateway list into the stored one. A blank `vendorPassword`
 * keeps the stored (encrypted) one; a non-blank value is a fresh plaintext
 * password that gets encrypted before it ever touches disk.
 */
function mergeCcGateways(existing: CcGateway[], incoming: CcGatewayPatch[]): CcGateway[] {
  const byId = new Map(existing.map((gateway) => [gateway.id, gateway]));
  return incoming.map((patch) => {
    const prev = patch.id ? byId.get(patch.id) : undefined;
    const nextPassword =
      patch.vendorPassword !== undefined && patch.vendorPassword !== ""
        ? encryptSecret(patch.vendorPassword)
        : prev?.vendorPassword ?? "";
    return {
      id: patch.id || randomUUID(),
      name: ((patch.name ?? prev?.name ?? "").trim()) || "Claude Gateway",
      baseUrl: (patch.baseUrl ?? prev?.baseUrl ?? "").trim().replace(/\/$/, ""),
      vendorEmail: (patch.vendorEmail ?? prev?.vendorEmail ?? "").trim(),
      vendorPassword: nextPassword,
      groupId: (patch.groupId ?? prev?.groupId ?? "").trim(),
    };
  });
}

/**
 * Merge an incoming sub2gw list into the stored one. A blank `adminPassword`
 * keeps the stored (encrypted) one; a non-blank value is fresh plaintext that is
 * encrypted before it ever touches disk.
 */
function mergeSub2Gws(existing: Sub2Gw[], incoming: Sub2GwPatch[]): Sub2Gw[] {
  const byId = new Map(existing.map((gateway) => [gateway.id, gateway]));
  return incoming.map((patch) => {
    const prev = patch.id ? byId.get(patch.id) : undefined;
    const nextPassword =
      patch.adminPassword !== undefined && patch.adminPassword !== ""
        ? encryptSecret(patch.adminPassword)
        : prev?.adminPassword ?? "";
    return {
      id: patch.id || randomUUID(),
      name: ((patch.name ?? prev?.name ?? "").trim()) || "Sub2API 网关",
      baseUrl: (patch.baseUrl ?? prev?.baseUrl ?? "").trim().replace(/\/$/, ""),
      adminEmail: (patch.adminEmail ?? prev?.adminEmail ?? "").trim(),
      adminPassword: nextPassword,
    };
  });
}

export async function addAuditEvent(event: Omit<AuditEvent, "id" | "createdAt">) {
  return mutateStore((store) => {
    store.audit.unshift({
      ...event,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    });
    store.audit = store.audit.slice(0, 300);
    return store.audit[0];
  });
}

export function toPublicAccount(account: LocalAccount): PublicAccount {
  const { passwordHash: _passwordHash, ...publicAccount } = account;
  return publicAccount;
}

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export class AccountStoreError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "AccountStoreError";
  }
}

async function mutateStore<T>(mutator: (store: LocalAccountStore) => T) {
  const store = await getAccountStore();
  const result = mutator(store);
  await saveAccountStore(store);
  return result;
}

async function saveAccountStore(store: LocalAccountStore) {
  const filePath = getStorePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function getStorePath() {
  return path.isAbsolute(env.LOCAL_ACCOUNT_STORE_PATH)
    ? env.LOCAL_ACCOUNT_STORE_PATH
    : path.join(/* turbopackIgnore: true */ process.cwd(), env.LOCAL_ACCOUNT_STORE_PATH);
}

function emptyStore(): LocalAccountStore {
  return { accounts: [], settings: { ...defaultSettings }, audit: [], backends: defaultBackendConfig(), poolOwnership: [], ledger: [], accountPrefixes: [], egressProxies: [], keyHealthStates: [] };
}

function normalizeStore(value: Partial<LocalAccountStore>): LocalAccountStore {
  return {
    accounts: Array.isArray(value.accounts) ? value.accounts.map(normalizeAccount) : [],
    settings: { ...defaultSettings, ...(value.settings || {}) },
    audit: Array.isArray(value.audit) ? value.audit.slice(0, 300) : [],
    backends: normalizeBackends(value.backends),
    poolOwnership: Array.isArray(value.poolOwnership) ? value.poolOwnership : [],
    ledger: Array.isArray(value.ledger) ? value.ledger : [],
    accountPrefixes: Array.isArray(value.accountPrefixes) ? value.accountPrefixes : [],
    egressProxies: Array.isArray(value.egressProxies) ? value.egressProxies : [],
    keyHealthStates: Array.isArray(value.keyHealthStates) ? value.keyHealthStates : [],
  };
}

/** Backfill fields added after a store was first written (legacy accounts). */
/** Keep only known modules, deduped and in canonical order. */
function sanitizeModules(modules: readonly ProvisioningModule[] | undefined): ProvisioningModule[] {
  const set = new Set(modules ?? []);
  return PROVISIONING_MODULES.filter((module) => set.has(module));
}

function normalizeAccount(account: LocalAccount): LocalAccount {
  return {
    ...account,
    targetBackend: account.targetBackend ?? null,
    // Grandfather pre-module accounts into onboarding; "key" stays opt-in.
    allowedModules: account.allowedModules ? sanitizeModules(account.allowedModules) : ["onboard"],
  };
}

/** Persisted shape may predate `customs` (single `custom`) — accept both. */
type LegacyBackendConfig = Partial<BackendConfigStore> & { custom?: Partial<CustomBackendConfig> };

function normalizeBackends(value?: LegacyBackendConfig): BackendConfigStore {
  const defaults = defaultBackendConfig();
  if (!value) return defaults;

  const customs = migrateCustomGateways(value, defaults.customs);
  const ccgateways = normalizeCcGateways(value.ccgateways);
  const sub2gws = normalizeSub2Gws(value.sub2gws);

  const sub2api = { ...defaults.sub2api, ...(value.sub2api || {}) };
  const newapi = { ...defaults.newapi, ...(value.newapi || {}) };
  const oneapi = { ...defaults.oneapi, ...(value.oneapi || {}) };

  // Legacy stores used the bare "custom" ref; remap it to the migrated gateway.
  const legacyCustomRef = customs[0] ? customRef(customs[0].id) : null;
  const mapRef = (ref: string): BackendRef => (ref === "custom" && legacyCustomRef ? legacyCustomRef : ref);
  const known = knownRefs(customs, ccgateways, sub2gws);

  const mappedEnabled = Array.isArray(value.enabled) ? value.enabled.map(mapRef).filter((ref) => known.has(ref)) : [];
  const enabled = mappedEnabled.length ? mappedEnabled : defaults.enabled;

  const mappedDefault = typeof value.defaultBackend === "string" ? mapRef(value.defaultBackend) : null;
  const defaultBackend =
    mappedDefault && known.has(mappedDefault)
      ? mappedDefault
      : known.has(defaults.defaultBackend)
        ? defaults.defaultBackend
        : enabled[0] ?? "sub2api";

  return { defaultBackend, enabled, sub2api, newapi, oneapi, customs, ccgateways, sub2gws };
}

/** Coerce a persisted sub2gw array into the current shape (keeps encrypted password). */
function normalizeSub2Gws(value: unknown): Sub2Gw[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((gateway): gateway is Record<string, unknown> => Boolean(gateway) && typeof gateway === "object")
    .map((gateway) => ({
      id: typeof gateway.id === "string" && gateway.id ? gateway.id : randomUUID(),
      name: (typeof gateway.name === "string" && gateway.name.trim()) || "Sub2API 网关",
      baseUrl: typeof gateway.baseUrl === "string" ? gateway.baseUrl : "",
      adminEmail: typeof gateway.adminEmail === "string" ? gateway.adminEmail : "",
      adminPassword: typeof gateway.adminPassword === "string" ? gateway.adminPassword : "",
    }));
}

/** Coerce a persisted ccgateway array into the current shape (drops junk, keeps encrypted password). */
function normalizeCcGateways(value: unknown): CcGateway[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((gateway): gateway is Record<string, unknown> => Boolean(gateway) && typeof gateway === "object")
    .map((gateway) => ({
      id: typeof gateway.id === "string" && gateway.id ? gateway.id : randomUUID(),
      name: (typeof gateway.name === "string" && gateway.name.trim()) || "Claude Gateway",
      baseUrl: typeof gateway.baseUrl === "string" ? gateway.baseUrl : "",
      vendorEmail: typeof gateway.vendorEmail === "string" ? gateway.vendorEmail : "",
      vendorPassword: typeof gateway.vendorPassword === "string" ? gateway.vendorPassword : "",
      groupId: typeof gateway.groupId === "string" ? gateway.groupId : "",
    }));
}

/** Prefer the new `customs` array; otherwise lift a legacy single `custom` into a gateway. */
function migrateCustomGateways(value: LegacyBackendConfig, fallback: CustomGateway[]): CustomGateway[] {
  if (Array.isArray(value.customs)) {
    return value.customs
      .filter((gateway): gateway is CustomGateway => Boolean(gateway) && typeof gateway === "object")
      .map((gateway) => ({
        id: typeof gateway.id === "string" && gateway.id ? gateway.id : randomUUID(),
        name: (typeof gateway.name === "string" && gateway.name.trim()) || "自建网关",
        url: typeof gateway.url === "string" ? gateway.url : "",
        token: typeof gateway.token === "string" ? gateway.token : "",
        listUrl: typeof gateway.listUrl === "string" ? gateway.listUrl : "",
      }));
  }

  const legacy = value.custom;
  if (legacy && (legacy.url || legacy.token || legacy.listUrl)) {
    return [
      {
        id: randomUUID(),
        name: "自建网关",
        url: legacy.url ?? "",
        token: legacy.token ?? "",
        listUrl: legacy.listUrl ?? "",
      },
    ];
  }

  return fallback;
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function isFileMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
