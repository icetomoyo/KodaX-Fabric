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

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
loadEnv({ path: resolve(rootDir, ".env") });
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  PORT: z.coerce.number().default(3100),
  HOST: z.string().default("0.0.0.0"),
  CORS_ORIGIN: z.string().default("http://127.0.0.1:5173"),
  JWT_SECRET: z.string().min(16),
  CREDENTIAL_ENCRYPT_KEY: z.string().min(16),
  RELAY_UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(300_000),
  RELAY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  RELAY_COOLDOWN_SECONDS: z.coerce.number().int().min(1).max(3_600).default(60),
  RELAY_SAFEGUARD_RPM: z.coerce.number().int().min(1).default(60),
  RELAY_SAFEGUARD_MAX_CONCURRENCY: z.coerce.number().int().min(1).default(5),
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
    .default(20 * 1024 * 1024),
  SEED_ADMIN_NAME: z.string().default("管理员"),
  SEED_ADMIN_PHONE: z.string().default("13800000000"),
  SEED_ADMIN_PASSWORD: z.string().min(8).default("ChangeMe@123"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
