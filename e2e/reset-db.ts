import postgres from "postgres";
import { E2E } from "./env.ts";

/**
 * 把 E2E 测试库重置为空 schema（每次运行都从 migrate+seed 的确定状态出发，
 * 用例因此可以使用固定名称与手机号，不依赖随机标记或清理逻辑）。
 * drizzle 的迁移日志表存放在独立的 drizzle schema，必须一并删除，
 * 否则迁移器认为已应用过而跳过，表却已不存在。
 * 只作用于 tokenhub_e2e，绝不触碰 dev 库。
 */
const db = postgres(E2E.databaseUrl, { max: 1 });

try {
  await db.unsafe("drop schema if exists public cascade");
  await db.unsafe("drop schema if exists drizzle cascade");
  await db.unsafe("create schema public");
  await db.end();
  console.log("[e2e] 测试库 schema 已重置");
} catch (error) {
  await db.end().catch(() => {});
  console.error(error);
  process.exit(1);
}
