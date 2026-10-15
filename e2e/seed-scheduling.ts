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
import { findRelayVariant, getChannelPlugin } from "../server/src/channels/index.js";
import { channelPoolKey } from "../server/src/lib/relay/channel-pool.js";
import {
  SCHED_DEPARTMENTS,
  SCHED_ENTERPRISE,
  SCHED_LOGIN_PASSWORD,
  SCHED_EXTERNAL_ENTERPRISE,
  SCHED_PEOPLE,
  SCHED_POOLS,
  SCHED_UI_PACKAGE,
  schedApiKey,
  schedLineCode,
  schedSecret,
  type SchedDeptKey,
  type SchedPerson,
  type SchedPersonKey,
  type SchedPoolDef,
  type SchedPoolKey,
} from "./scheduling-fixture.ts";

/**
 * 渠道 Key 调度 E2E 夹具：编制树、人员、每个场景一条智谱套餐、渠道 Key、席位和员工 API Key。
 * 在 db:seed / seed-org 之后执行，测试库每次运行都会重置，所以只做插入。
 *
 * 渠道只用注册表里的真实渠道（db:seed 已写入 providers）。一个渠道一个调度池，
 * 所以场景套餐全部以停用状态入库，用例开跑前用 isolateChannelPool 只启用自己那条。
 * 官方网关地址由 rewrite-upstream-fetch 打到本机 mock。
 */
async function channelProviderId(code: string): Promise<number> {
  const [row] = await db
    .select({ id: providers.id })
    .from(providers)
    .where(eq(providers.code, code))
    .limit(1);
  if (!row) throw new Error(`渠道 ${code} 未入库，先跑 db:seed`);
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
    const loginPasswordHash = await hashPassword(SCHED_LOGIN_PASSWORD);
    const employeeIds = {} as Record<SchedPersonKey, number>;
    for (const key of Object.keys(SCHED_PEOPLE) as SchedPersonKey[]) {
      const def: SchedPerson = SCHED_PEOPLE[key];
      const [row] = await db
        .insert(employees)
        .values({
          name: def.name,
          phone: def.phone,
          passwordHash: def.canLogin ? loginPasswordHash : passwordHash,
          role: def.role ?? "employee",
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

    const glm = getChannelPlugin("glm");
    const glmVariant = findRelayVariant(glm);
    if (!glmVariant) throw new Error("智谱渠道缺少 relay 网关");
    const glmId = await channelProviderId(glm.code);
    const summary: Record<string, unknown> = {};
    for (const poolKey of Object.keys(SCHED_POOLS) as SchedPoolKey[]) {
      const pool: SchedPoolDef = SCHED_POOLS[poolKey];
      const [line] = await db
        .insert(productLines)
        .values({
          providerId: glmId,
          code: schedLineCode(poolKey),
          name: pool.name,
          tag: glmVariant.label,
          productType: glm.productType,
          protocolConfigs: glmVariant.protocolConfigs,
          configVersion: 1,
          seatCount: pool.keys.length,
          status: "disabled",
          testModel: glm.models.testModel,
          fiveHourCreditLimit:
            pool.fiveHourCreditLimit != null ? String(pool.fiveHourCreditLimit) : null,
          weeklyCreditLimit: pool.weeklyCreditLimit != null ? String(pool.weeklyCreditLimit) : null,
          relayPoolKey: channelPoolKey(glm.code),
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

    // 界面用例用的智谱套餐：停用的 Key，没有 API Key，不会产生任何上游调用。
    const [uiLine] = await db
      .insert(productLines)
      .values({
        providerId: glmId,
        code: SCHED_UI_PACKAGE.code,
        name: SCHED_UI_PACKAGE.name,
        tag: glmVariant.label,
        productType: glm.productType,
        protocolConfigs: glmVariant.protocolConfigs,
        configVersion: 1,
        seatCount: SCHED_UI_PACKAGE.keys.length,
        status: "active",
        relayPoolKey: channelPoolKey(glm.code),
      })
      .returning({ id: productLines.id });
    for (const keyDef of SCHED_UI_PACKAGE.keys) {
      const secret = `sk-sched-ui-${keyDef.label}`;
      await db.insert(upstreamCredentials).values({
        productLineId: uiLine.id,
        label: `调度-${keyDef.label}`,
        secretEncrypted: encryptSecret(secret),
        secretSuffix: secretSuffix(secret),
        supportedProtocols: ["openai_chat"],
        weight: 100,
        priority: 0,
        status: "disabled",
      });
    }
    summary.uiPackage = { productLineId: uiLine.id, keys: SCHED_UI_PACKAGE.keys.length };

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
