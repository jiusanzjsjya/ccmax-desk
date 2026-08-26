import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.string().default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SESSION_SECRET: z
    .string()
    .min(16)
    .default("dev-only-session-secret-change-before-production"),
  ADMIN_ACCESS_KEY: z.string().default(""),
  SUB2API_BASE_URL: z.string().url().default("http://localhost:8080"),
  SUB2API_ADMIN_TOKEN: z.string().default(""),
  LOCAL_ACCOUNT_STORE_PATH: z.string().min(1).default(".data/accounts.json"),
  SUB2API_PROXY_ID: z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : value),
    z.coerce.number().int().positive().optional(),
  ),
  PROVISIONING_SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(3600).default(1800),

  // Target account pool / gateway. The Claude OAuth handshake is always
  // brokered by Sub2API for now; BACKEND_KIND only selects where the finished
  // account is written.
  BACKEND_KIND: z.enum(["sub2api", "newapi", "oneapi", "custom"]).default("sub2api"),

  // new-api (fork of one-api). Needs a numeric user id for the New-Api-User header.
  NEWAPI_BASE_URL: z.string().default(""),
  NEWAPI_ADMIN_TOKEN: z.string().default(""),
  NEWAPI_USER_ID: z.string().default(""),
  NEWAPI_CHANNEL_TYPE: z.coerce.number().int().default(14),
  NEWAPI_MODELS: z.string().default("claude-3-5-sonnet-latest"),

  // one-api.
  ONEAPI_BASE_URL: z.string().default(""),
  ONEAPI_ADMIN_TOKEN: z.string().default(""),
  ONEAPI_CHANNEL_TYPE: z.coerce.number().int().default(14),
  ONEAPI_MODELS: z.string().default("claude-3-5-sonnet-latest"),

  // Self-built gateway. Receives a Sub2API-shaped account payload at CUSTOM_BACKEND_URL.
  CUSTOM_BACKEND_URL: z.string().default(""),
  CUSTOM_BACKEND_TOKEN: z.string().default(""),
  CUSTOM_BACKEND_LIST_URL: z.string().default(""),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  throw new Error(`环境变量配置无效：${parsedEnv.error.message}`);
}

const values = parsedEnv.data;

function isBackendConfigured(kind: (typeof values)["BACKEND_KIND"]) {
  switch (kind) {
    case "sub2api":
      return Boolean(values.SUB2API_ADMIN_TOKEN);
    case "newapi":
      return Boolean(values.NEWAPI_BASE_URL && values.NEWAPI_ADMIN_TOKEN);
    case "oneapi":
      return Boolean(values.ONEAPI_BASE_URL && values.ONEAPI_ADMIN_TOKEN);
    case "custom":
      return Boolean(values.CUSTOM_BACKEND_URL);
    default:
      return false;
  }
}

export const env = {
  ...values,
  isAdminConfigured: Boolean(values.ADMIN_ACCESS_KEY),
  isSub2ApiConfigured: Boolean(values.SUB2API_ADMIN_TOKEN),
  // The OAuth broker is always Sub2API, so a Sub2API admin token is required
  // regardless of the destination backend.
  isProvisioningConfigured: Boolean(values.ADMIN_ACCESS_KEY && values.SUB2API_ADMIN_TOKEN),
  isBackendConfigured,
};

export function getSub2ApiConfig() {
  if (!env.isSub2ApiConfigured) {
    throw new Error("Sub2API 管理令牌尚未配置");
  }

  const baseUrl = new URL(env.SUB2API_BASE_URL);

  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new Error("SUB2API_BASE_URL 必须使用 HTTP(S) URL");
  }

  return {
    baseUrl: env.SUB2API_BASE_URL.replace(/\/$/, ""),
    adminToken: env.SUB2API_ADMIN_TOKEN,
    proxyId: env.SUB2API_PROXY_ID,
  };
}
