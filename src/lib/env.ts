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
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  throw new Error(`环境变量配置无效：${parsedEnv.error.message}`);
}

const values = parsedEnv.data;

export const env = {
  ...values,
  isAdminConfigured: Boolean(values.ADMIN_ACCESS_KEY),
  isSub2ApiConfigured: Boolean(values.SUB2API_ADMIN_TOKEN),
  isProvisioningConfigured: Boolean(values.ADMIN_ACCESS_KEY && values.SUB2API_ADMIN_TOKEN),
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
