import type { FastifyInstance } from "fastify";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import {
  channelSeats,
  employeeApiKeys,
  employees,
  enterprises,
  productLines,
  providers,
  requestAudits,
  tidalGrants,
  upstreamCredentials,
} from "../../db/schema/index.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import {
  loadRelayPool,
  pooledProductLineDisplayName,
} from "../../lib/relay/channel-pool.js";
import {
  snapshotRelayLiveLoad,
  snapshotTidalInFlight,
} from "../../lib/relay/credential-load.js";
import { isOpenPoolProvider } from "../../lib/relay/open-pool.js";
import { DEFAULT_RELAY_PROTOCOL } from "../../lib/relay/protocol.js";
import { previewTidalPool } from "../../lib/relay/tidal-pool.js";
import {
  isTidalWindowOpen,
  loadTidalSettings,
  saveTidalSettings,
  tidalSettingsSchema,
} from "../../lib/relay/tidal-settings.js";
import { requireSession, requireTrueAdmin } from "../../middleware/auth.js";

const grantLimitsSchema = {
  maxConcurrency: z.number().int().min(1).max(200),
  rpmLimit: z.number().int().min(1).max(100_000),
  /** ISO 时间；null 表示长期有效。 */
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  note: z.string().trim().max(200).nullable().optional(),
};

const createGrantSchema = z.object({
  employeeId: z.number().int().positive(),
  ...grantLimitsSchema,
});

const updateGrantSchema = z
  .object({
    maxConcurrency: grantLimitsSchema.maxConcurrency.optional(),
    rpmLimit: grantLimitsSchema.rpmLimit.optional(),
    expiresAt: grantLimitsSchema.expiresAt,
    note: grantLimitsSchema.note,
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined));

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

/** A new expiry must lie in the future; null and undefined pass through. */
function parseExpiry(value: string | null | undefined): Date | null | undefined | "past" {
  if (value === undefined || value === null) return value;
  const date = new Date(value);
  return date.getTime() > Date.now() ? date : "past";
}

async function settingsPayload() {
  const settings = await loadTidalSettings();
  return {
    settings,
    timezone: env.QUOTA_TIMEZONE,
    windowOpen: settings.enabled && isTidalWindowOpen(settings),
  };
}

/**
 * 潮汐调度（超级管理员）：全局规则、授权名单、当前运行情况。
 * 以临时身份代看别的角色时也要求本人是超级管理员。
 */
export async function adminTidalRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requireTrueAdmin());

  app.get("/api/admin/tidal/settings", async () => ({
    success: true,
    data: await settingsPayload(),
  }));

  app.put("/api/admin/tidal/settings", async (req, reply) => {
    const body = tidalSettingsSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({
        success: false,
        message: body.error.issues[0]?.message ?? "参数无效",
      });
    }
    const settings = await saveTidalSettings(body.data);
    await writeOpsAudit({
      actorEmployeeId: req.employeeId,
      action: "tidal.settings.update",
      targetType: "system_setting",
      targetId: "tidal_scheduling",
      detail: settings,
      ip: req.ip,
    });
    return { success: true, data: await settingsPayload() };
  });

  app.get("/api/admin/tidal/grants", async () => {
    const granter = alias(employees, "granter");
    const rows = await db
      .select({
        id: tidalGrants.id,
        employeeId: tidalGrants.employeeId,
        employeeName: employees.name,
        employeePhone: employees.phone,
        employeeDept: employees.dept,
        enterpriseName: enterprises.name,
        maxConcurrency: tidalGrants.maxConcurrency,
        rpmLimit: tidalGrants.rpmLimit,
        expiresAt: tidalGrants.expiresAt,
        note: tidalGrants.note,
        grantedByName: granter.name,
        createdAt: tidalGrants.createdAt,
        keyId: employeeApiKeys.id,
        keyPrefix: employeeApiKeys.keyPrefix,
        keyLastUsedAt: employeeApiKeys.lastUsedAt,
      })
      .from(tidalGrants)
      .innerJoin(employees, eq(employees.id, tidalGrants.employeeId))
      .leftJoin(enterprises, eq(enterprises.id, employees.enterpriseId))
      .leftJoin(granter, eq(granter.id, tidalGrants.grantedBy))
      .leftJoin(
        employeeApiKeys,
        and(
          eq(employeeApiKeys.employeeId, tidalGrants.employeeId),
          eq(employeeApiKeys.mode, "tidal"),
        ),
      )
      .orderBy(desc(tidalGrants.id));

    const live = new Map(snapshotRelayLiveLoad().keys.map((node) => [node.id, node.inFlight]));
    const now = Date.now();
    return {
      success: true,
      data: rows.map(({ keyId, keyPrefix, keyLastUsedAt, ...row }) => ({
        ...row,
        expired: row.expiresAt != null && row.expiresAt.getTime() <= now,
        key: keyId == null ? null : { id: keyId, keyPrefix, lastUsedAt: keyLastUsedAt },
        inFlight: keyId == null ? 0 : (live.get(keyId) ?? 0),
      })),
    };
  });

  app.post("/api/admin/tidal/grants", async (req, reply) => {
    const body = createGrantSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const expiresAt = parseExpiry(body.data.expiresAt);
    if (expiresAt === "past") {
      return reply.code(400).send({ success: false, message: "到期时间必须晚于现在" });
    }

    const [target] = await db
      .select({
        id: employees.id,
        name: employees.name,
        role: employees.role,
        status: employees.status,
        enterpriseId: employees.enterpriseId,
      })
      .from(employees)
      .where(eq(employees.id, body.data.employeeId))
      .limit(1);
    // 潮汐KEY 走 relay：超级管理员账号和没有企业的账号本来就不能调用。
    if (
      !target ||
      target.status !== "active" ||
      target.role === "admin" ||
      target.enterpriseId == null
    ) {
      return reply.code(400).send({
        success: false,
        code: "tidal_grant_target_invalid",
        message: "只能授权给已加入企业的在职员工",
      });
    }

    const [created] = await db
      .insert(tidalGrants)
      .values({
        employeeId: target.id,
        maxConcurrency: body.data.maxConcurrency,
        rpmLimit: body.data.rpmLimit,
        expiresAt: expiresAt ?? null,
        note: body.data.note || null,
        grantedBy: req.employeeId,
      })
      .onConflictDoNothing({ target: tidalGrants.employeeId })
      .returning();
    if (!created) {
      return reply.code(409).send({
        success: false,
        code: "tidal_grant_exists",
        message: "该员工已有潮汐授权",
      });
    }

    await writeOpsAudit({
      actorEmployeeId: req.employeeId,
      action: "tidal.grant.create",
      targetType: "employee",
      targetId: String(target.id),
      detail: {
        employeeName: target.name,
        maxConcurrency: created.maxConcurrency,
        rpmLimit: created.rpmLimit,
        expiresAt: created.expiresAt,
        note: created.note,
      },
      ip: req.ip,
    });
    return { success: true, data: created };
  });

  app.patch("/api/admin/tidal/grants/:id", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    const body = updateGrantSchema.safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const expiresAt = parseExpiry(body.data.expiresAt);
    if (expiresAt === "past") {
      return reply.code(400).send({ success: false, message: "到期时间必须晚于现在" });
    }

    const [updated] = await db
      .update(tidalGrants)
      .set({
        ...(body.data.maxConcurrency !== undefined
          ? { maxConcurrency: body.data.maxConcurrency }
          : {}),
        ...(body.data.rpmLimit !== undefined ? { rpmLimit: body.data.rpmLimit } : {}),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
        ...(body.data.note !== undefined ? { note: body.data.note || null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(tidalGrants.id, params.data.id))
      .returning();
    if (!updated) {
      return reply.code(404).send({ success: false, message: "授权不存在" });
    }

    await writeOpsAudit({
      actorEmployeeId: req.employeeId,
      action: "tidal.grant.update",
      targetType: "employee",
      targetId: String(updated.employeeId),
      detail: {
        maxConcurrency: updated.maxConcurrency,
        rpmLimit: updated.rpmLimit,
        expiresAt: updated.expiresAt,
        note: updated.note,
      },
      ip: req.ip,
    });
    return { success: true, data: updated };
  });

  app.delete("/api/admin/tidal/grants/:id", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    // 撤销授权时把这个人的潮汐KEY 一并删掉：再次授权要重新建，旧 KEY 不会复活。
    const revoked = await db.transaction(async (tx) => {
      const [grant] = await tx
        .delete(tidalGrants)
        .where(eq(tidalGrants.id, params.data.id))
        .returning();
      if (!grant) return null;
      const keys = await tx
        .delete(employeeApiKeys)
        .where(
          and(
            eq(employeeApiKeys.employeeId, grant.employeeId),
            eq(employeeApiKeys.mode, "tidal"),
          ),
        )
        .returning({ id: employeeApiKeys.id, keyPrefix: employeeApiKeys.keyPrefix });
      return { grant, keys };
    });
    if (!revoked) {
      return reply.code(404).send({ success: false, message: "授权不存在" });
    }

    await writeOpsAudit({
      actorEmployeeId: req.employeeId,
      action: "tidal.grant.revoke",
      targetType: "employee",
      targetId: String(revoked.grant.employeeId),
      detail: {
        maxConcurrency: revoked.grant.maxConcurrency,
        rpmLimit: revoked.grant.rpmLimit,
        deletedKeys: revoked.keys,
      },
      ip: req.ip,
    });
    return { success: true };
  });

  /** 当前运行情况：各调度池里有多少把 Key 可借、哪些 Key 正在跑潮汐请求、近 24 小时消耗。 */
  app.get("/api/admin/tidal/overview", async () => {
    const lines = await db
      .select({
        id: productLines.id,
        name: productLines.name,
        relayPoolKey: productLines.relayPoolKey,
        providerCode: providers.code,
      })
      .from(productLines)
      .innerJoin(providers, eq(providers.id, productLines.providerId))
      .where(and(eq(productLines.status, "active"), eq(providers.status, "active")))
      .orderBy(productLines.id);

    const pools: Array<{
      poolKey: string;
      name: string;
      preview: Awaited<ReturnType<typeof previewTidalPool>>;
    }> = [];
    const seen = new Set<string>();
    for (const line of lines) {
      if (isOpenPoolProvider(line.providerCode)) continue;
      const pool = await loadRelayPool(line.id);
      if (!pool || seen.has(pool.key)) continue;
      seen.add(pool.key);
      const preview = await previewTidalPool(pool, DEFAULT_RELAY_PROTOCOL);
      if (preview.total === 0) continue;
      pools.push({
        poolKey: pool.key,
        name: pooledProductLineDisplayName({
          relayPoolKey: line.relayPoolKey || pool.key,
          productLineName: line.name,
        }),
        preview,
      });
    }

    const tidalInFlight = snapshotTidalInFlight();
    const liveIds = [...tidalInFlight.keys()];
    const liveRows = liveIds.length === 0
      ? []
      : await db
          .select({
            credentialId: upstreamCredentials.id,
            label: upstreamCredentials.label,
            secretSuffix: upstreamCredentials.secretSuffix,
            productLineName: productLines.name,
            ownerName: employees.name,
          })
          .from(upstreamCredentials)
          .innerJoin(productLines, eq(productLines.id, upstreamCredentials.productLineId))
          .leftJoin(channelSeats, eq(channelSeats.credentialId, upstreamCredentials.id))
          .leftJoin(employees, eq(employees.id, channelSeats.employeeId))
          .where(inArray(upstreamCredentials.id, liveIds));

    const since = new Date(Date.now() - 24 * 3_600_000);
    const [usage] = await db
      .select({
        requests: sql<number>`count(*)::int`,
        errors: sql<number>`(count(*) filter (where ${requestAudits.status} <> 'success'))::int`,
        totalTokens: sql<number>`coalesce(sum(${requestAudits.totalTokens}), 0)::float8`,
        credits: sql<number>`coalesce(sum(${requestAudits.requestCredits}), 0)::float8`,
        keysUsed: sql<number>`count(distinct ${requestAudits.credentialId})::int`,
      })
      .from(requestAudits)
      .where(and(eq(requestAudits.tidal, true), gte(requestAudits.createdAt, since)));

    return {
      success: true,
      data: {
        pools,
        live: liveRows
          .map((row) => ({ ...row, tidalInFlight: tidalInFlight.get(row.credentialId) ?? 0 }))
          .sort((a, b) => b.tidalInFlight - a.tidalInFlight || a.credentialId - b.credentialId),
        last24h: usage ?? { requests: 0, errors: 0, totalTokens: 0, credits: 0, keysUsed: 0 },
      },
    };
  });
}
