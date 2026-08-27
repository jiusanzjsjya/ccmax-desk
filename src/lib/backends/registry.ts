import { getBackendSettings, getCustomGateway, getRelayConfig, isBackendConfigured } from "@/lib/backend-config";
import { customIdFromRef, refKind, type BackendRef } from "@/lib/backends/kinds";
import { Sub2ApiError } from "@/lib/sub2api";
import { customBackend } from "./custom";
import { createRelayBackend } from "./relay";
import { sub2apiBackend, sub2apiOAuthBroker } from "./sub2api";
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
    default:
      throw new Sub2ApiError(`未知的目标后端：${target}`);
  }
}

/**
 * The Claude OAuth broker. Always Sub2API today; its config comes from the
 * store via lib/backend-config.
 */
export function resolveOAuthBroker(): OAuthBroker {
  return sub2apiOAuthBroker;
}
