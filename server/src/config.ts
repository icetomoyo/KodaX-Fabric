import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
loadEnv({ path: resolve(rootDir, ".env") });
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  PORT: z.coerce.number().default(3100),
  HOST: z.string().default("127.0.0.1"),
  CORS_ORIGIN: z.string().default("http://127.0.0.1:5173"),
  JWT_SECRET: z.string().min(16),
  CREDENTIAL_ENCRYPT_KEY: z.string().min(16),
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
