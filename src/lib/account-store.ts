import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import path from "node:path";

import { env } from "@/lib/env";
import type { Role } from "@/lib/roles";
import { BACKEND_KINDS, type BackendKind } from "@/lib/backends/kinds";

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
  adminToken: string;
  userId: string;
  channelType: number;
  models: string;
};
export type CustomBackendConfig = { url: string; token: string; listUrl: string };

/** Superadmin-editable multi-platform backend configuration (persisted). */
export type BackendConfigStore = {
  defaultBackend: BackendKind;
  enabled: BackendKind[];
  sub2api: Sub2ApiBackendConfig;
  newapi: RelayBackendConfig;
  oneapi: Omit<RelayBackendConfig, "userId">;
  custom: CustomBackendConfig;
};

export type LocalAccountStore = {
  accounts: LocalAccount[];
  settings: SystemSettings;
  audit: AuditEvent[];
  backends: BackendConfigStore;
};

const defaultSettings: SystemSettings = {
  provisioningEnabled: true,
  allowAdminCreateUsers: true,
  allowUserProvisioning: true,
  allowAdminAccountPoolView: true,
  allowUserAccountPoolView: false,
};

/** Seed backend config from env on first run; the store is authoritative after. */
function defaultBackendConfig(): BackendConfigStore {
  const config: Omit<BackendConfigStore, "enabled"> = {
    defaultBackend: env.BACKEND_KIND,
    sub2api: { baseUrl: env.SUB2API_BASE_URL, adminToken: env.SUB2API_ADMIN_TOKEN, proxyId: env.SUB2API_PROXY_ID ?? null },
    newapi: {
      baseUrl: env.NEWAPI_BASE_URL,
      adminToken: env.NEWAPI_ADMIN_TOKEN,
      userId: env.NEWAPI_USER_ID,
      channelType: env.NEWAPI_CHANNEL_TYPE,
      models: env.NEWAPI_MODELS,
    },
    oneapi: {
      baseUrl: env.ONEAPI_BASE_URL,
      adminToken: env.ONEAPI_ADMIN_TOKEN,
      channelType: env.ONEAPI_CHANNEL_TYPE,
      models: env.ONEAPI_MODELS,
    },
    custom: { url: env.CUSTOM_BACKEND_URL, token: env.CUSTOM_BACKEND_TOKEN, listUrl: env.CUSTOM_BACKEND_LIST_URL },
  };
  const enabled = BACKEND_KINDS.filter((kind) => isBackendConfigInPlace(kind, config));
  return { ...config, enabled: enabled.length ? enabled : ["sub2api"] };
}

/** True when a backend has the minimum fields to be usable. */
export function isBackendConfigInPlace(kind: BackendKind, config: Omit<BackendConfigStore, "enabled" | "defaultBackend">) {
  switch (kind) {
    case "sub2api":
      return Boolean(config.sub2api.baseUrl && config.sub2api.adminToken);
    case "newapi":
      return Boolean(config.newapi.baseUrl && config.newapi.adminToken);
    case "oneapi":
      return Boolean(config.oneapi.baseUrl && config.oneapi.adminToken);
    case "custom":
      return Boolean(config.custom.url);
    default:
      return false;
  }
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

export type BackendConfigPatch = {
  defaultBackend?: BackendKind;
  enabled?: BackendKind[];
  sub2api?: Partial<Sub2ApiBackendConfig>;
  newapi?: Partial<RelayBackendConfig>;
  oneapi?: Partial<Omit<RelayBackendConfig, "userId">>;
  custom?: Partial<CustomBackendConfig>;
};

export async function getBackendConfigStore() {
  const store = await getAccountStore();
  return store.backends;
}

export async function updateBackendSettings(patch: BackendConfigPatch) {
  return mutateStore((store) => {
    const backends = store.backends;
    if (patch.defaultBackend) backends.defaultBackend = patch.defaultBackend;
    if (patch.enabled) backends.enabled = patch.enabled.filter((kind) => BACKEND_KINDS.includes(kind));
    if (patch.sub2api) backends.sub2api = { ...backends.sub2api, ...patch.sub2api };
    if (patch.newapi) backends.newapi = { ...backends.newapi, ...patch.newapi };
    if (patch.oneapi) backends.oneapi = { ...backends.oneapi, ...patch.oneapi };
    if (patch.custom) backends.custom = { ...backends.custom, ...patch.custom };
    return backends;
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
  return { accounts: [], settings: { ...defaultSettings }, audit: [], backends: defaultBackendConfig() };
}

function normalizeStore(value: Partial<LocalAccountStore>): LocalAccountStore {
  return {
    accounts: Array.isArray(value.accounts) ? value.accounts : [],
    settings: { ...defaultSettings, ...(value.settings || {}) },
    audit: Array.isArray(value.audit) ? value.audit.slice(0, 300) : [],
    backends: normalizeBackends(value.backends),
  };
}

function normalizeBackends(value?: Partial<BackendConfigStore>): BackendConfigStore {
  const defaults = defaultBackendConfig();
  if (!value) return defaults;

  return {
    defaultBackend: value.defaultBackend ?? defaults.defaultBackend,
    enabled:
      Array.isArray(value.enabled) && value.enabled.length
        ? value.enabled.filter((kind) => BACKEND_KINDS.includes(kind))
        : defaults.enabled,
    sub2api: { ...defaults.sub2api, ...(value.sub2api || {}) },
    newapi: { ...defaults.newapi, ...(value.newapi || {}) },
    oneapi: { ...defaults.oneapi, ...(value.oneapi || {}) },
    custom: { ...defaults.custom, ...(value.custom || {}) },
  };
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function isFileMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
