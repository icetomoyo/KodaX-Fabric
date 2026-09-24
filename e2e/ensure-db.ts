import postgres from "postgres";
import { E2E_ADMIN_DATABASE_URL, E2E_DATABASE_NAME } from "./env.ts";

/**
 * 在 dev 实例上确保存在专属 E2E 库（不存在则创建，已存在则跳过）。
 * 作为被测 server 启动链的第一步执行，先于 migrate / seed / 起服。
 */
const admin = postgres(E2E_ADMIN_DATABASE_URL, { max: 1 });

try {
  const existing = await admin`select 1 from pg_database where datname = ${E2E_DATABASE_NAME}`;
  if (existing.length === 0) {
    await admin.unsafe(`create database "${E2E_DATABASE_NAME}"`);
    console.log(`[e2e] 已创建测试数据库 ${E2E_DATABASE_NAME}`);
  }
  await admin.end();
} catch (error) {
  await admin.end().catch(() => {});
  console.error(error);
  process.exit(1);
}
