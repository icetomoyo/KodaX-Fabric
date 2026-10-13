import { eq } from "drizzle-orm";
import { db, sql } from "../server/src/db/client.js";
import {
  channelSeats,
  departments,
  employeeApiKeys,
  employees,
  productLines,
  providers,
  teamMembers,
  upstreamCredentials,
} from "../server/src/db/schema/index.js";
import { encryptEmployeeApiKey, hashApiKey } from "../server/src/lib/api-key.js";
import { encryptSecret, secretSuffix } from "../server/src/lib/crypto-secret.js";
import { ensureDefaultTeam, insertEnterprise } from "../server/src/lib/enterprise.js";
import { hashPassword, REGISTRATION_INITIAL_PASSWORD } from "../server/src/lib/password.js";
import { HAIZHI_PROVIDER_CODE, HAIZHI_PROVIDER_NAME } from "../server/src/lib/provider-templates.js";
import { E2E } from "./env.ts";
import {
  SCHED_DEPARTMENTS,
  SCHED_ENTERPRISE,
  SCHED_EXTERNAL_ENTERPRISE,
  SCHED_PEOPLE,
  SCHED_POOLS,
  schedApiKey,
  schedSecret,
  type SchedDeptKey,
  type SchedPersonKey,
  type SchedPoolDef,
  type SchedPoolKey,
} from "./scheduling-fixture.ts";

/**
 * 渠道 Key 调度 E2E 夹具：编制树、人员、每个场景一条 haizhi 自建渠道
 * （上游指向本机 mock）、渠道 Key、席位和员工 API Key。
 * 在 db:seed / seed-org 之后执行，测试库每次运行都会重置，所以只做插入。
 */
async function ensureHaizhiProvider(): Promise<number> {
  await db
    .insert(providers)
    .values({
      code: HAIZHI_PROVIDER_CODE,
      name: HAIZHI_PROVIDER_NAME,
      defaultBaseUrl: `${E2E.mockUpstreamBaseUrl}/v1`,
      authStyle: "bearer",
      openaiCompatLevel: "full",
      status: "active",
    })
    .onConflictDoNothing({ target: providers.code });
  const [row] = await db
    .select({ id: providers.id })
    .from(providers)
    .where(eq(providers.code, HAIZHI_PROVIDER_CODE))
    .limit(1);
  if (!row) throw new Error("haizhi 供应商创建失败");
  return row.id;
}

async function main() {
  try {
    const mainEnterprise = await insertEnterprise({ name: SCHED_ENTERPRISE.name, status: "active" });
    const externalEnterprise = await insertEnterprise({
      name: SCHED_EXTERNAL_ENTERPRISE.name,
      status: "active",
    });

    // 部门按定义顺序插入：父节点都排在子节点前面。
    const departmentIds = {} as Record<SchedDeptKey, number>;
    const teamIds = {} as Record<SchedDeptKey, number>;
    const enterpriseIdOf = (key: SchedDeptKey) =>
      SCHED_DEPARTMENTS[key].external ? externalEnterprise.id : mainEnterprise.id;
    for (const key of Object.keys(SCHED_DEPARTMENTS) as SchedDeptKey[]) {
      const def = SCHED_DEPARTMENTS[key];
      const enterpriseId = enterpriseIdOf(key);
      const [row] = await db
        .insert(departments)
        .values({
          enterpriseId,
          parentId: def.parent ? departmentIds[def.parent] : null,
          name: def.name,
          status: "active",
          isDefault: false,
        })
        .returning({ id: departments.id });
      departmentIds[key] = row.id;
      teamIds[key] = await ensureDefaultTeam(row.id, enterpriseId);
    }

    const passwordHash = await hashPassword(REGISTRATION_INITIAL_PASSWORD);
    const employeeIds = {} as Record<SchedPersonKey, number>;
    for (const key of Object.keys(SCHED_PEOPLE) as SchedPersonKey[]) {
      const def = SCHED_PEOPLE[key];
      const [row] = await db
        .insert(employees)
        .values({
          name: def.name,
          phone: def.phone,
          passwordHash,
          role: "employee",
          status: "active",
          enterpriseId: enterpriseIdOf(def.depts[0]),
          mustChangePassword: false,
        })
        .returning({ id: employees.id });
      employeeIds[key] = row.id;
      for (const dept of def.depts) {
        await db.insert(teamMembers).values({ teamId: teamIds[dept], employeeId: row.id });
      }
    }

    const providerId = await ensureHaizhiProvider();
    const summary: Record<string, unknown> = {};
    for (const poolKey of Object.keys(SCHED_POOLS) as SchedPoolKey[]) {
      const pool: SchedPoolDef = SCHED_POOLS[poolKey];
      const [line] = await db
        .insert(productLines)
        .values({
          providerId,
          code: `hz_sched_${poolKey.toLowerCase()}`,
          name: pool.name,
          tag: "调度E2E",
          productType: "api",
          protocolConfigs: {
            openai_chat: { baseUrl: `${E2E.mockUpstreamBaseUrl}/v1`, authStyle: "bearer" },
          },
          configVersion: 1,
          seatCount: pool.keys.length,
          status: "active",
          testModel: "e2e-upstream-model",
        })
        .returning({ id: productLines.id });

      for (const keyDef of pool.keys) {
        const secret = schedSecret(poolKey, keyDef.label);
        const [credential] = await db
          .insert(upstreamCredentials)
          .values({
            productLineId: line.id,
            label: `调度-${keyDef.label}`,
            secretEncrypted: encryptSecret(secret),
            secretSuffix: secretSuffix(secret),
            supportedProtocols: ["openai_chat"],
            weight: 100,
            priority: 0,
            status: "active",
            fiveHourCreditLimit:
              keyDef.fiveHourCreditLimit != null ? String(keyDef.fiveHourCreditLimit) : null,
            weeklyCreditLimit:
              keyDef.weeklyCreditLimit != null ? String(keyDef.weeklyCreditLimit) : null,
          })
          .returning({ id: upstreamCredentials.id });
        if (keyDef.owner) {
          await db.insert(channelSeats).values({
            employeeId: employeeIds[keyDef.owner],
            productLineId: line.id,
            credentialId: credential.id,
            tag: "",
          });
        }
      }

      for (const user of pool.users) {
        const raw = schedApiKey(poolKey, user);
        await db.insert(employeeApiKeys).values({
          employeeId: employeeIds[user],
          name: `调度E2E-${poolKey}`,
          keyPrefix: raw.slice(0, 10),
          keyHash: hashApiKey(raw),
          keyEncrypted: encryptEmployeeApiKey(raw),
          protocol: "openai_chat",
          productLineId: line.id,
          teamId: teamIds[SCHED_PEOPLE[user].depts[0]],
          status: "active",
        });
      }
      summary[poolKey] = { productLineId: line.id, keys: pool.keys.length, users: pool.users.length };
    }

    console.log("[e2e] scheduling fixtures ready", {
      enterprise: mainEnterprise.id,
      externalEnterprise: externalEnterprise.id,
      people: Object.keys(employeeIds).length,
      pools: summary,
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
