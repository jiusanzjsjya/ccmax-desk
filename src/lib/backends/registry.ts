import { getBackendSettings, getCcGateway, getCustomGateway, getRelayConfig, getSub2ApiConfig, getSub2Gw, isBackendConfigured } from "@/lib/backend-config";
import { ccgatewayIdFromRef, customIdFromRef, refKind, sub2gwIdFromRef, type BackendRef } from "@/lib/backends/kinds";
import { Sub2ApiError, type Sub2ApiRequestConfig } from "@/lib/sub2api";
import { ccgatewayBackend } from "./ccgateway";
import { customBackend } from "./custom";
import { createRelayBackend } from "./relay";
import { sub2apiBackend, sub2apiOAuthBroker } from "./sub2api";
import { sub2gwBackend, sub2GwRequestConfig } from "./sub2gw";
import type { OAuthBroker, PoolBackend } from "./types";

/**
 * Resolve a target account pool from the superadmin-managed config. Defaults to
 * the configured default backend when no ref is given. A ref is either a
 * singleton kind ("sub2api" | "newapi" | "oneapi") or "custom:<gatewayId>".
 */
export async function resolveBackend(ref?: BackendRef): Promise<PoolBackend> {
  const settings = await getBackendSettings();
  const target = ref ?? settings.defaultBackend;

  if (!(await isBackendConfigured(target))) {
    throw new Sub2ApiError(`目标后端 ${target} 尚未配置，请在超管后台完成配置`);
  }

  switch (refKind(target)) {
    case "sub2api":
      return sub2apiBackend;
    case "newapi": {
      const cfg = await getRelayConfig("newapi");
      return createRelayBackend({
        kind: "newapi",
        label: "new-api",
        baseUrl: cfg.baseUrl.replace(/\/$/, ""),
        adminToken: cfg.adminToken,
        userId: cfg.userId || undefined,
        channelType: cfg.channelType,
        models: cfg.models,
        apiKey: cfg.apiKey,
      });
    }
    case "oneapi": {
      const cfg = await getRelayConfig("oneapi");
      return createRelayBackend({
        kind: "oneapi",
        label: "one-api",
        baseUrl: cfg.baseUrl.replace(/\/$/, ""),
        adminToken: cfg.adminToken,
        channelType: cfg.channelType,
        models: cfg.models,
        apiKey: cfg.apiKey,
      });
    }
    case "custom": {
      const id = customIdFromRef(target);
      const gateway = id ? await getCustomGateway(id) : null;
      if (!gateway) {
        throw new Sub2ApiError(`自建网关不存在或已删除：${target}`);
      }
      return customBackend(gateway);
    }
    case "ccgateway": {
      const id = ccgatewayIdFromRef(target);
      const gateway = id ? await getCcGateway(id) : null;
      if (!gateway) {
        throw new Sub2ApiError(`Claude Gateway 不存在或已删除：${target}`);
      }
      return ccgatewayBackend(gateway);
    }
    case "sub2gw": {
      const id = sub2gwIdFromRef(target);
      const gateway = id ? await getSub2Gw(id) : null;
      if (!gateway) {
        throw new Sub2ApiError(`Sub2API 网关不存在或已删除：${target}`);
      }
      return sub2gwBackend(gateway);
    }
    default:
      throw new Sub2ApiError(`未知的目标后端：${target}`);
  }
}

/**
 * Resolve a Sub2API request config (baseUrl + auth) for an OpenAI-key-capable
 * target. Only the primary `sub2api` (admin key) and a `sub2gw` (password login)
 * expose the OpenAI api-key endpoints; every other backend is rejected. Used by
 * the 上key / Key使用额度 routes so those flows can target either.
 */
export async function resolveOpenAIConfig(ref: BackendRef): Promise<Sub2ApiRequestConfig> {
  if (!(await isBackendConfigured(ref))) {
    throw new Sub2ApiError(`目标平台 ${ref} 尚未配置，请在超管后台完成配置`);
  }
  switch (refKind(ref)) {
    case "sub2api":
      return getSub2ApiConfig();
    case "sub2gw": {
      const id = sub2gwIdFromRef(ref);
      const gateway = id ? await getSub2Gw(id) : null;
      if (!gateway) throw new Sub2ApiError(`Sub2API 网关不存在或已删除：${ref}`);
      return sub2GwRequestConfig(gateway);
    }
    default:
      throw new Sub2ApiError("该目标平台不支持上 OpenAI Key（仅 Sub2API 及 Sub2API 网关支持）", 400);
  }
}

/**
 * The Claude OAuth broker. Always Sub2API today; its config comes from the
 * store via lib/backend-config.
 */
export function resolveOAuthBroker(): OAuthBroker {
  return sub2apiOAuthBroker;
}
