import {
  getBackendConfigStore,
  isBackendConfigInPlace,
  type BackendConfigStore,
  type CustomBackendConfig,
  type RelayBackendConfig,
  type Sub2ApiBackendConfig,
} from "@/lib/account-store";
import type { BackendKind } from "@/lib/backends/kinds";

/** The superadmin-managed backend configuration (store over env seed). */
export async function getBackendSettings(): Promise<BackendConfigStore> {
  return getBackendConfigStore();
}

/** Sub2API is the Claude OAuth broker AND a possible target pool. */
export async function getSub2ApiConfig(): Promise<{ baseUrl: string; adminToken: string; proxyId?: number }> {
  const { sub2api } = await getBackendSettings();
  if (!sub2api.adminToken || !sub2api.baseUrl) {
    throw new Error("Sub2API 尚未配置，请在超管后台填写地址与管理令牌");
  }

  const url = new URL(sub2api.baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Sub2API 地址必须是 HTTP(S) URL");
  }

  return {
    baseUrl: sub2api.baseUrl.replace(/\/$/, ""),
    adminToken: sub2api.adminToken,
    proxyId: sub2api.proxyId ?? undefined,
  };
}

export async function getRelayConfig(kind: "newapi" | "oneapi"): Promise<RelayBackendConfig> {
  const settings = await getBackendSettings();
  if (kind === "newapi") return settings.newapi;
  return { ...settings.oneapi, userId: "" };
}

export async function getCustomConfig(): Promise<CustomBackendConfig> {
  return (await getBackendSettings()).custom;
}

export async function isBackendConfigured(kind: BackendKind): Promise<boolean> {
  return isBackendConfigInPlace(kind, await getBackendSettings());
}

/** Sub2API brokers the Claude OAuth handshake, so it must be configured to start any flow. */
export async function isSub2ApiConfigured(): Promise<boolean> {
  return isBackendConfigured("sub2api");
}

/** Backends the wizard may offer: enabled AND actually configured. */
export async function selectableBackends(): Promise<{ default: BackendKind; kinds: BackendKind[] }> {
  const settings = await getBackendSettings();
  const kinds = settings.enabled.filter((kind) => isBackendConfigInPlace(kind, settings));
  const fallback = kinds.length ? kinds : isBackendConfigInPlace("sub2api", settings) ? (["sub2api"] as BackendKind[]) : [];
  const chosen = kinds.includes(settings.defaultBackend) ? settings.defaultBackend : fallback[0];
  return { default: chosen ?? "sub2api", kinds: fallback };
}

export function assertSub2ApiConfig(config: Sub2ApiBackendConfig) {
  return Boolean(config.baseUrl && config.adminToken);
}
