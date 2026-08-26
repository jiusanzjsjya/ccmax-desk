import { env } from "@/lib/env";
import { createRelayBackend } from "./relay";
import type { PoolBackend } from "./types";

/** one-api target pool (channel-based). Configure via ONEAPI_* env vars. */
export function oneApiBackend(): PoolBackend {
  return createRelayBackend({
    kind: "oneapi",
    label: "one-api",
    baseUrl: env.ONEAPI_BASE_URL.replace(/\/$/, ""),
    adminToken: env.ONEAPI_ADMIN_TOKEN,
    channelType: env.ONEAPI_CHANNEL_TYPE,
    models: env.ONEAPI_MODELS,
  });
}
