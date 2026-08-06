import { eq } from "drizzle-orm";
import { env } from "../config.js";
import { db, sql } from "./client.js";
import { employees, quotaPolicy, systemSettings } from "./schema/index.js";
import { hashPassword } from "../lib/password.js";

/** 仅种子管理员账号；供应商/凭证/路由等由管理员在后台录入，不做演示数据。 */
async function seedAdmin() {
  const [existing] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.phone, env.SEED_ADMIN_PHONE))
    .limit(1);

  if (existing) {
    console.log("Admin already exists:", env.SEED_ADMIN_PHONE);
    return;
  }

  const passwordHash = await hashPassword(env.SEED_ADMIN_PASSWORD);
  const [admin] = await db
    .insert(employees)
    .values({
      name: env.SEED_ADMIN_NAME,
      phone: env.SEED_ADMIN_PHONE,
      passwordHash,
      role: "admin",
      mustChangePassword: true,
      status: "active",
    })
    .returning({ id: employees.id, phone: employees.phone });

  console.log("Seeded admin:", admin.phone, "(must change password on first login)");
}

/** 系统运行所需的最小配置（非业务演示数据） */
async function seedMinimalSystemConfig() {
  const inserted = await db
    .insert(quotaPolicy)
    .values({ key: "default", dailyTokenLimit: 500_000_000 })
    .onConflictDoNothing()
    .returning({ key: quotaPolicy.key });

  if (inserted.length) {
    console.log("Seeded default quota policy");
  }

  await db
    .insert(systemSettings)
    .values({
      key: "employee_can_read_own_body",
      value: true,
    })
    .onConflictDoNothing();
}

async function main() {
  await sql`select 1`;
  await seedAdmin();
  await seedMinimalSystemConfig();
  await sql.end({ timeout: 5 });
  console.log("Seed complete (users + minimal system config only)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
