import { env } from "@/lib/env";
import { Sub2ApiError } from "@/lib/sub2api";
import { customBackend } from "./custom";
import { newApiBackend } from "./newapi";
import { oneApiBackend } from "./oneapi";
import { sub2apiBackend, sub2apiOAuthBroker } from "./sub2api";
import type { BackendKind, OAuthBroker, PoolBackend } from "./types";

/**
 * Resolve the configured target account pool. Defaults to Sub2API so existing
 * deployments keep working with no config change.
 */
export function resolveBackend(kind: BackendKind = env.BACKEND_KIND): PoolBackend {
  if (!env.isBackendConfigured(kind)) {
    throw new Sub2ApiError(`目标后端 ${kind} 尚未配置，请检查对应环境变量`);
  }

  switch (kind) {
    case "sub2api":
      return sub2apiBackend;
    case "newapi":
      return newApiBackend();
    case "oneapi":
      return oneApiBackend();
    case "custom":
      return customBackend();
    default:
      throw new Sub2ApiError(`未知的目标后端：${kind}`);
  }
}

/**
 * The Claude OAuth broker. Always Sub2API today; a native Claude provider can
 * be swapped in here later without touching route handlers.
 */
export function resolveOAuthBroker(): OAuthBroker {
  return sub2apiOAuthBroker;
}
