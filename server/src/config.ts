import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

function isValidIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function envBoolean(defaultValue: boolean) {
  return z.preprocess((value: unknown) => {
    if (value === undefined || value === null || value === "") return defaultValue;
    if (typeof value === "boolean") return value;
    const normalized = String(value).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    return value;
  }, z.boolean());
}

function optionalSecret() {
  return z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    });
}

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
loadEnv({ path: resolve(rootDir, ".env") });
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  CORS_ORIGIN: z.string().default("http://127.0.0.1:5173"),
  JWT_SECRET: z.string().min(16),
  CREDENTIAL_ENCRYPT_KEY: z.string().min(16),
  RELAY_UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(300_000),
  RELAY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  RELAY_COOLDOWN_SECONDS: z.coerce.number().int().min(1).max(3_600).default(300),
  RELAY_QUOTA_COOLDOWN_SECONDS: z.coerce.number().int().min(1).max(86_400).default(1_800),
  RELAY_SAFEGUARD_RPM: z.coerce.number().int().min(1).default(60),
  RELAY_SAFEGUARD_MAX_CONCURRENCY: z.coerce.number().int().min(1).default(5),
  // 渠道 Key 调度：每把 Key 最多挂几个员工、最多几个在途请求。
  RELAY_KEY_MAX_MEMBERS: z.coerce.number().int().min(1).max(100).default(3),
  RELAY_KEY_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(1_000).default(9),
  // 每个员工同时最多几路（所有 Key 加起来）。当前 Key 满了而员工没到这个数，就换绑到有空位的 Key。
  RELAY_EMPLOYEE_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(1_000).default(9),
  // 成员多久没调用就从 Key 上释放，以及清理任务多久跑一次。
  RELAY_KEY_IDLE_RELEASE_SECONDS: z.coerce.number().int().min(60).max(604_800).default(1_800),
  RELAY_KEY_IDLE_SWEEP_SECONDS: z.coerce.number().int().min(1).max(3_600).default(60),
  // 潮汐调度：池内 Key 状态和用量账本的快照复用多久（每个潮汐请求都要看全池）。
  RELAY_TIDAL_SNAPSHOT_TTL_MS: z.coerce.number().int().min(0).max(60_000).default(2_000),
  QUOTA_TIMEZONE: z
    .string()
    .default("Asia/Shanghai")
    .refine(isValidIanaTimeZone, "必须是有效的 IANA 时区名"),
  RELAY_RESPONSE_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .default(100 * 1024 * 1024),
  AUDIT_BODY_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .default(1 * 1024 * 1024),
  REQUEST_CONTEXT_DIR: z.string().min(1).default("request-context"),
  REQUEST_CONTEXT_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .default(50 * 1024 * 1024),
  REQUEST_CONTEXT_BLOB_MIN_BYTES: z.coerce
    .number()
    .int()
    .min(64)
    .default(1024),
  ALERT_CHECK_INTERVAL_SECONDS: z.coerce.number().int().min(10).default(60),
  ALERT_COOLING_RATIO_THRESHOLD: z.coerce.number().min(0).max(1).default(0.3),
  ALERT_SILENCE_SECONDS: z.coerce.number().int().min(0).default(900),
  ALERT_WEBHOOK_URL: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    }),
  SEED_ADMIN_NAME: z.string().default("管理员"),
  SEED_ADMIN_PHONE: z.string().default("18620260213"),
  SEED_ADMIN_PASSWORD: z.string().min(8).default("Pwd@2026"),
  SUPPORT_BOT_ENABLED: envBoolean(true),
  SUPPORT_BOT_MODEL: z.string().trim().min(1).default("glm-5.3-flash"),
  SUPPORT_BOT_UPSTREAM_BASE_URL: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : "https://open.bigmodel.cn/api/coding/paas/v4";
    })
    .refine((value) => URL.canParse(value), "must be a URL"),
  SUPPORT_BOT_UPSTREAM_API_KEY: optionalSecret(),
  SUPPORT_BOT_RATE_LIMIT_PER_HOUR: z.coerce.number().int().min(1).default(30),
  DINGTALK_APP_KEY: optionalSecret(),
  DINGTALK_APP_SECRET: optionalSecret(),
  DINGTALK_LOGIN_REDIRECT_URI: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    })
    .refine((value) => value == null || URL.canParse(value), "must be a URL"),
  LDAP_URL: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    }),
  LDAP_BASE: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    }),
  SUPPORT_BOT_AGENT_MAX_TURNS: z.coerce.number().int().min(1).max(8).default(4),
  SUPPORT_BOT_AGENT_TIMEOUT_MS: z.coerce.number().int().min(5_000).default(45_000),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
