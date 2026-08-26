import { env } from "@/lib/env";
import { createRelayBackend } from "./relay";
import type { PoolBackend } from "./types";

/** new-api target pool (channel-based). Configure via NEWAPI_* env vars. */
export function newApiBackend(): PoolBackend {
  return createRelayBackend({
    kind: "newapi",
    label: "new-api",
    baseUrl: env.NEWAPI_BASE_URL.replace(/\/$/, ""),
    adminToken: env.NEWAPI_ADMIN_TOKEN,
    userId: env.NEWAPI_USER_ID || undefined,
    channelType: env.NEWAPI_CHANNEL_TYPE,
    models: env.NEWAPI_MODELS,
  });
}
