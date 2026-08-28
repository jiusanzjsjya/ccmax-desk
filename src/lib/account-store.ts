import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import path from "node:path";

import { env } from "@/lib/env";
import type { Role } from "@/lib/roles";
import { customIdFromRef, customRef, refKind, type BackendRef } from "@/lib/backends/kinds";

export type LocalAccount = {
  id: string;
  username: string;
  displayName: string;
  role: Exclude<Role, "superadmin">;
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
  allowAdminAccountPoolView: boolean;
  allowUserAccountPoolView: boolean;
  /** When true, a `user` only sees accounts they personally onboarded. */
  scopeAccountPoolByOwner: boolean;
  /** Master switch for the data-analysis / settlement-ledger module. */
  settlementModuleEnabled: boolean;
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
};

export type LocalAccountStore = {
  accounts: LocalAccount[];
  settings: SystemSettings;
  audit: AuditEvent[];
  backends: BackendConfigStore;
  poolOwnership: PoolOwnership[];
  ledger: LedgerEntry[];
};

const defaultSettings: SystemSettings = {
  provisioningEnabled: true,
  allowAdminCreateUsers: true,
  allowUserProvisioning: true,
  allowAdminAccountPoolView: true,
  allowUserAccountPoolView: false,
  scopeAccountPoolByOwner: true,
  settlementModuleEnabled: true,
};

/** The connection/config-bearing slice of the backend store used for checks. */
type BackendConfigFields = Pick<BackendConfigStore, "sub2api" | "newapi" | "oneapi" | "customs">;

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
  return refs;
}

/** The set of refs that exist at all (singletons + defined gateways), configured or not. */
function knownRefs(customs: CustomGateway[]): Set<BackendRef> {
  return new Set<BackendRef>([...SINGLETON_KINDS, ...customs.map((gateway) => customRef(gateway.id))]);
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
  input: { role?: Exclude<Role, "superadmin">; disabled?: boolean; displayName?: string },
) {
  return mutateStore((store) => {
    const account = store.accounts.find((item) => item.id === accountId);
    if (!account) return null;

    if (input.role) account.role = input.role;
    if (typeof input.disabled === "boolean") account.disabled = input.disabled;
    if (typeof input.displayName === "string" && input.displayName.trim()) {
      account.displayName = input.displayName.trim();
    }
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

/** One gateway in a PATCH: `id` present = edit existing (blank token keeps stored). */
export type CustomGatewayPatch = { id?: string; name?: string; url?: string; token?: string; listUrl?: string };

export type BackendConfigPatch = {
  defaultBackend?: BackendRef;
  enabled?: BackendRef[];
  sub2api?: Partial<Sub2ApiBackendConfig>;
  newapi?: Partial<RelayBackendConfig>;
  oneapi?: Partial<Omit<RelayBackendConfig, "userId">>;
  customs?: CustomGatewayPatch[];
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

    // enabled / default may point at gateways; keep them valid against the current set.
    const known = knownRefs(backends.customs);
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
  return { accounts: [], settings: { ...defaultSettings }, audit: [], backends: defaultBackendConfig(), poolOwnership: [], ledger: [] };
}

function normalizeStore(value: Partial<LocalAccountStore>): LocalAccountStore {
  return {
    accounts: Array.isArray(value.accounts) ? value.accounts : [],
    settings: { ...defaultSettings, ...(value.settings || {}) },
    audit: Array.isArray(value.audit) ? value.audit.slice(0, 300) : [],
    backends: normalizeBackends(value.backends),
    poolOwnership: Array.isArray(value.poolOwnership) ? value.poolOwnership : [],
    ledger: Array.isArray(value.ledger) ? value.ledger : [],
  };
}

/** Persisted shape may predate `customs` (single `custom`) — accept both. */
type LegacyBackendConfig = Partial<BackendConfigStore> & { custom?: Partial<CustomBackendConfig> };

function normalizeBackends(value?: LegacyBackendConfig): BackendConfigStore {
  const defaults = defaultBackendConfig();
  if (!value) return defaults;

  const customs = migrateCustomGateways(value, defaults.customs);

  const sub2api = { ...defaults.sub2api, ...(value.sub2api || {}) };
  const newapi = { ...defaults.newapi, ...(value.newapi || {}) };
  const oneapi = { ...defaults.oneapi, ...(value.oneapi || {}) };

  // Legacy stores used the bare "custom" ref; remap it to the migrated gateway.
  const legacyCustomRef = customs[0] ? customRef(customs[0].id) : null;
  const mapRef = (ref: string): BackendRef => (ref === "custom" && legacyCustomRef ? legacyCustomRef : ref);
  const known = knownRefs(customs);

  const mappedEnabled = Array.isArray(value.enabled) ? value.enabled.map(mapRef).filter((ref) => known.has(ref)) : [];
  const enabled = mappedEnabled.length ? mappedEnabled : defaults.enabled;

  const mappedDefault = typeof value.defaultBackend === "string" ? mapRef(value.defaultBackend) : null;
  const defaultBackend =
    mappedDefault && known.has(mappedDefault)
      ? mappedDefault
      : known.has(defaults.defaultBackend)
        ? defaults.defaultBackend
        : enabled[0] ?? "sub2api";

  return { defaultBackend, enabled, sub2api, newapi, oneapi, customs };
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
