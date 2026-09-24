import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseEnvFile } from "dotenv";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const rootEnv = parseEnvFile(readFileSync(resolve(repoRoot, ".env"), "utf8"));

/**
 * 管理连接只从根 .env 读取（不读 process.env）：
 * 我们给被测进程注入的 DATABASE_URL 就是测试库地址，读它会自己连自己。
 */
const devDatabaseUrl = rootEnv.DATABASE_URL;
if (!devDatabaseUrl) {
  throw new Error("根 .env 缺少 DATABASE_URL，无法派生 E2E 测试库连接");
}

/**
 * E2E 数据库从根 .env 的 dev 连接派生（同实例、同账号、独立库名 tokenhub_e2e），
 * 不依赖并不存在的 test/test 账号，也绝不触碰 dev 库 tokenhub。
 * Redis 复用 dev 的认证信息，切到 db 15。
 */
function deriveDatabaseUrl(): string {
  return new URL(E2E_DATABASE_NAME, devDatabaseUrl).toString();
}

function deriveRedisUrl(): string {
  return new URL("/15", rootEnv.REDIS_URL ?? "redis://127.0.0.1:6379/0").toString();
}

export const E2E_DATABASE_NAME = "tokenhub_e2e";
export const E2E_ADMIN_DATABASE_URL = devDatabaseUrl;

/**
 * E2E 专用运行时约定：与 dev 进程（3000/5173）完全隔离的端口、
 * 独立的测试数据库与 Redis db，以及可重复 seed 的管理员账号。
 */
export const E2E = {
  apiPort: 3310,
  webPort: 5174,
  apiBaseUrl: "http://127.0.0.1:3310",
  webBaseUrl: "http://127.0.0.1:5174",
  mockUpstreamPort: 3311,
  mockUpstreamBaseUrl: "http://127.0.0.1:3311",
  databaseUrl: deriveDatabaseUrl(),
  redisUrl: deriveRedisUrl(),
  jwtSecret: "e2e-jwt-secret-0123456789abcdef",
  credentialEncryptKey: "e2e-credential-key-0123456789abcdef",
  admin: {
    name: "E2E管理员",
    phone: "13800000001",
    password: "E2eAdmin@2026",
  },
} as const;

/** 被测 server 进程与 db:migrate / db:seed 共用的环境变量覆盖。 */
export function e2eServerEnv(): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: E2E.databaseUrl,
    REDIS_URL: E2E.redisUrl,
    JWT_SECRET: E2E.jwtSecret,
    CREDENTIAL_ENCRYPT_KEY: E2E.credentialEncryptKey,
    PORT: String(E2E.apiPort),
    HOST: "127.0.0.1",
    CORS_ORIGIN: E2E.webBaseUrl,
    SEED_ADMIN_NAME: E2E.admin.name,
    SEED_ADMIN_PHONE: E2E.admin.phone,
    SEED_ADMIN_PASSWORD: E2E.admin.password,
  };
}
