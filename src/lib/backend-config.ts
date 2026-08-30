import {
  getBackendConfigStore,
  isBackendRefConfigured,
  type BackendConfigStore,
  type CcGateway,
  type CustomGateway,
  type RelayBackendConfig,
  type Sub2ApiBackendConfig,
} from "@/lib/account-store";
import { backendLabel, ccgatewayIdFromRef, customIdFromRef, refKind, type BackendKind, type BackendRef } from "@/lib/backends/kinds";

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

export async function getCustomGateway(id: string): Promise<CustomGateway | null> {
  const { customs } = await getBackendSettings();
  return customs.find((gateway) => gateway.id === id) ?? null;
}

/** One Claude Gateway (vendor) instance by id; `vendorPassword` stays encrypted. */
export async function getCcGateway(id: string): Promise<CcGateway | null> {
  const { ccgateways } = await getBackendSettings();
  return ccgateways.find((gateway) => gateway.id === id) ?? null;
}

export async function isBackendConfigured(ref: BackendRef): Promise<boolean> {
  return isBackendRefConfigured(ref, await getBackendSettings());
}

/** Sub2API brokers the Claude OAuth handshake, so it must be configured to start any flow. */
export async function isSub2ApiConfigured(): Promise<boolean> {
  return isBackendConfigured("sub2api");
}

export type SelectableBackend = { ref: BackendRef; kind: BackendKind; label: string };

/** Backends the wizard may offer: enabled AND actually configured. */
export async function selectableBackends(): Promise<{ default: BackendRef; items: SelectableBackend[] }> {
  const settings = await getBackendSettings();
  const enabledItems = settings.enabled
    .filter((ref) => isBackendRefConfigured(ref, settings))
    .map((ref) => ({ ref, kind: refKind(ref), label: refLabel(ref, settings) }));

  // Fall back to Sub2API when nothing is enabled+configured but Sub2API itself is usable.
  const items: SelectableBackend[] =
    enabledItems.length
      ? enabledItems
      : isBackendRefConfigured("sub2api", settings)
        ? [{ ref: "sub2api", kind: "sub2api", label: "Sub2API" }]
        : [];

  const refs = new Set(items.map((item) => item.ref));
  const chosen = refs.has(settings.defaultBackend) ? settings.defaultBackend : items[0]?.ref;
  return { default: chosen ?? "sub2api", items };
}

/** Display label for a ref — a gateway's own name, or the singleton kind label. */
function refLabel(ref: BackendRef, settings: BackendConfigStore): string {
  const customId = customIdFromRef(ref);
  if (customId) {
    const gateway = settings.customs.find((item) => item.id === customId);
    return gateway?.name || "自建网关";
  }
  const ccId = ccgatewayIdFromRef(ref);
  if (ccId) {
    const gateway = settings.ccgateways.find((item) => item.id === ccId);
    return gateway?.name || "Claude Gateway";
  }
  return backendLabel(refKind(ref));
}

export function assertSub2ApiConfig(config: Sub2ApiBackendConfig) {
  return Boolean(config.baseUrl && config.adminToken);
}
