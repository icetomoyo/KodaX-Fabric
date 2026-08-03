import { eq } from "drizzle-orm";
import { env } from "../config.js";
import { db, sql } from "./client.js";
import {
  employees,
  productLines,
  providers,
  quotaPolicies,
  systemSettings,
} from "./schema/index.js";
import { hashPassword } from "../lib/password.js";

const PROVIDER_SEED: Array<{
  code: string;
  name: string;
  defaultBaseUrl: string;
  lines: Array<{
    code: string;
    name: string;
    productType: "api" | "coding_plan";
    shareMode: "public_pool" | "grant_only" | "disabled";
    allowAutoRoute: boolean;
  }>;
}> = [
  {
    code: "zhipu_cn",
    name: "智谱国内",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    lines: [
      {
        code: "api",
        name: "API",
        productType: "api",
        shareMode: "public_pool",
        allowAutoRoute: true,
      },
      {
        code: "coding_plan",
        name: "Coding Plan",
        productType: "coding_plan",
        shareMode: "grant_only",
        allowAutoRoute: false,
      },
    ],
  },
  {
    code: "zhipu_intl",
    name: "智谱国际",
    defaultBaseUrl: "https://api.z.ai/api/paas/v4",
    lines: [
      {
        code: "api",
        name: "API",
        productType: "api",
        shareMode: "public_pool",
        allowAutoRoute: true,
      },
    ],
  },
  {
    code: "deepseek",
    name: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com",
    lines: [
      {
        code: "api",
        name: "API",
        productType: "api",
        shareMode: "public_pool",
        allowAutoRoute: true,
      },
    ],
  },
  {
    code: "kimi",
    name: "Kimi (Moonshot)",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    lines: [
      {
        code: "api",
        name: "API",
        productType: "api",
        shareMode: "public_pool",
        allowAutoRoute: true,
      },
      {
        code: "coding_plan",
        name: "Coding Plan",
        productType: "coding_plan",
        shareMode: "grant_only",
        allowAutoRoute: false,
      },
    ],
  },
  {
    code: "minimax",
    name: "MiniMax",
    defaultBaseUrl: "https://api.minimax.chat/v1",
    lines: [
      {
        code: "api",
        name: "API",
        productType: "api",
        shareMode: "public_pool",
        allowAutoRoute: true,
      },
    ],
  },
];

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

async function seedProviders() {
  for (const p of PROVIDER_SEED) {
    const [existing] = await db
      .select({ id: providers.id })
      .from(providers)
      .where(eq(providers.code, p.code))
      .limit(1);

    let providerId = existing?.id;
    if (!providerId) {
      const [row] = await db
        .insert(providers)
        .values({
          code: p.code,
          name: p.name,
          defaultBaseUrl: p.defaultBaseUrl,
        })
        .returning({ id: providers.id });
      providerId = row.id;
      console.log("Seeded provider:", p.code);
    }

    const allLines = await db
      .select()
      .from(productLines)
      .where(eq(productLines.providerId, providerId));

    for (const line of p.lines) {
      if (allLines.some((l) => l.code === line.code)) continue;

      await db.insert(productLines).values({
        providerId,
        code: line.code,
        name: line.name,
        productType: line.productType,
        shareMode: line.shareMode,
        allowAutoRoute: line.allowAutoRoute,
      });
      console.log("  product line:", p.code, line.code);
    }
  }
}

async function seedQuotaAndSettings() {
  const [def] = await db
    .select({ id: quotaPolicies.id })
    .from(quotaPolicies)
    .where(eq(quotaPolicies.isDefault, true))
    .limit(1);

  if (!def) {
    await db.insert(quotaPolicies).values({
      name: "default",
      softTpmDay: 2_000_000,
      hardTpmDay: null,
      rpm: 60,
      maxConcurrency: 5,
      softReqDay: 2000,
      hardReqDay: null,
      isDefault: true,
    });
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
  await seedProviders();
  await seedQuotaAndSettings();
  await sql.end({ timeout: 5 });
  console.log("Seed complete");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
