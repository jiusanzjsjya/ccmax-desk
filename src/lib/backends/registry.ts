import { getCustomConfig, getBackendSettings, getRelayConfig, isBackendConfigured } from "@/lib/backend-config";
import { Sub2ApiError } from "@/lib/sub2api";
import { customBackend } from "./custom";
import { createRelayBackend } from "./relay";
import { sub2apiBackend, sub2apiOAuthBroker } from "./sub2api";
import type { BackendKind, OAuthBroker, PoolBackend } from "./types";

/**
 * Resolve a target account pool from the superadmin-managed config. Defaults to
 * the configured default backend when no kind is given.
 */
export async function resolveBackend(kind?: BackendKind): Promise<PoolBackend> {
  const settings = await getBackendSettings();
  const target = kind ?? settings.defaultBackend;

  if (!(await isBackendConfigured(target))) {
    throw new Sub2ApiError(`目标后端 ${target} 尚未配置，请在超管后台完成配置`);
  }

  switch (target) {
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
      });
    }
    case "custom":
      return customBackend(await getCustomConfig());
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
