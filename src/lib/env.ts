import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.string().default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SESSION_SECRET: z
    .string()
    .min(16)
    .default("dev-only-session-secret-change-before-production"),

  // Superadmin bootstrap. The superadmin now signs in with an account name and
  // password (default name "admin"); the legacy access-key field is gone.
  SUPERADMIN_USERNAME: z.string().default("admin"),
  SUPERADMIN_PASSWORD: z.string().default(""),

  LOCAL_ACCOUNT_STORE_PATH: z.string().min(1).default(".data/accounts.json"),
  PROVISIONING_SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(3600).default(1800),

  // The following backend values are only SEED DEFAULTS. On first run they are
  // copied into the persisted store; afterwards the superadmin edits them in the
  // console and the store is the source of truth (see lib/backend-config.ts).
  BACKEND_KIND: z.enum(["sub2api", "newapi", "oneapi", "custom"]).default("sub2api"),

  SUB2API_BASE_URL: z.string().url().default("http://localhost:8080"),
  SUB2API_ADMIN_TOKEN: z.string().default(""),
  SUB2API_PROXY_ID: z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : value),
    z.coerce.number().int().positive().optional(),
  ),

  NEWAPI_BASE_URL: z.string().default(""),
  NEWAPI_ADMIN_TOKEN: z.string().default(""),
  NEWAPI_USER_ID: z.string().default(""),
  NEWAPI_CHANNEL_TYPE: z.coerce.number().int().default(14),
  NEWAPI_MODELS: z.string().default("claude-3-5-sonnet-latest"),
  NEWAPI_ANTHROPIC_API_KEY: z.string().default(""),

  ONEAPI_BASE_URL: z.string().default(""),
  ONEAPI_ADMIN_TOKEN: z.string().default(""),
  ONEAPI_CHANNEL_TYPE: z.coerce.number().int().default(14),
  ONEAPI_MODELS: z.string().default("claude-3-5-sonnet-latest"),
  ONEAPI_ANTHROPIC_API_KEY: z.string().default(""),

  CUSTOM_BACKEND_URL: z.string().default(""),
  CUSTOM_BACKEND_TOKEN: z.string().default(""),
  CUSTOM_BACKEND_LIST_URL: z.string().default(""),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  throw new Error(`环境变量配置无效：${parsedEnv.error.message}`);
}

const values = parsedEnv.data;

export const env = {
  ...values,
  isSuperadminConfigured: Boolean(values.SUPERADMIN_USERNAME && values.SUPERADMIN_PASSWORD),
};
