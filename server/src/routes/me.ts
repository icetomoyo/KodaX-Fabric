import type { FastifyInstance } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, sql as querySql } from "../db/client.js";
import {
  employeeApiKeys,
  opsAuditLogs,
  requestAuditBodies,
  requestAudits,
  usageCountersDaily,
} from "../db/schema/index.js";
import { encryptEmployeeApiKey, generateApiKey } from "../lib/api-key.js";
import { writeOpsAudit } from "../lib/ops-audit.js";
import { requirePasswordChanged, requireSession } from "../middleware/auth.js";

export async function meRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);

  app.get("/api/me/api-keys", async (req) => {
    const rows = await db
      .select({
        id: employeeApiKeys.id,
        name: employeeApiKeys.name,
        keyPrefix: employeeApiKeys.keyPrefix,
        status: employeeApiKeys.status,
        lastUsedAt: employeeApiKeys.lastUsedAt,
        createdAt: employeeApiKeys.createdAt,
      })
      .from(employeeApiKeys)
      .where(eq(employeeApiKeys.employeeId, req.employeeId!))
      .orderBy(desc(employeeApiKeys.id));

    return { success: true, data: rows };
  });

  app.post("/api/me/api-keys", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Pragma", "no-cache");
    const body = z
      .object({ name: z.string().min(1).max(100).default("default") })
      .safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const { raw, prefix, hash } = generateApiKey();
    const keyEncrypted = encryptEmployeeApiKey(raw);
    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(employeeApiKeys)
        .values({
          employeeId: req.employeeId!,
          name: body.data.name,
          keyPrefix: prefix,
          keyHash: hash,
          keyEncrypted,
        })
        .returning({
          id: employeeApiKeys.id,
          name: employeeApiKeys.name,
          keyPrefix: employeeApiKeys.keyPrefix,
          status: employeeApiKeys.status,
          createdAt: employeeApiKeys.createdAt,
        });

      await tx.insert(opsAuditLogs).values({
        actorEmployeeId: req.employeeId,
        action: "api_key.create",
        targetType: "employee_api_key",
        targetId: String(created.id),
        ip: req.ip,
      });

      return created;
    });

    return {
      success: true,
      data: {
        ...row,
        key: raw,
        notice: "请立即保存，明文仅展示一次",
      },
    };
  });

  app.post("/api/me/api-keys/:id/revoke", async (req, reply) => {
    const params = z.object({ id: z.coerce.number() }).safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const [row] = await db
      .update(employeeApiKeys)
      .set({ status: "revoked" })
      .where(
        and(
          eq(employeeApiKeys.id, params.data.id),
          eq(employeeApiKeys.employeeId, req.employeeId!),
        ),
      )
      .returning({ id: employeeApiKeys.id });

    if (!row) {
      return reply.code(404).send({ success: false, message: "密钥不存在" });
    }

    await writeOpsAudit({
      actorEmployeeId: req.employeeId,
      action: "api_key.revoke",
      targetType: "employee_api_key",
      targetId: String(row.id),
      ip: req.ip,
    });

    return { success: true };
  });

  app.get("/api/me/usage", async (req) => {
    const [{ today }] = await querySql<{ today: string }[]>`
      select current_date::text as today
    `;
    const [day] = await db
      .select()
      .from(usageCountersDaily)
      .where(
        and(
          eq(usageCountersDaily.employeeId, req.employeeId!),
          eq(usageCountersDaily.day, today),
        ),
      )
      .limit(1);

    const [month] = await db
      .select({
        totalTokens: sql<number>`coalesce(sum(${usageCountersDaily.totalTokens}), 0)`,
        requestCount: sql<number>`coalesce(sum(${usageCountersDaily.requestCount}), 0)`,
      })
      .from(usageCountersDaily)
      .where(
        and(
          eq(usageCountersDaily.employeeId, req.employeeId!),
          sql`${usageCountersDaily.day} >= date_trunc('month', current_date)::date`,
        ),
      );

    return {
      success: true,
      data: {
        today: day ?? {
          day: today,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          requestCount: 0,
          errorCount: 0,
        },
        month: {
          totalTokens: Number(month?.totalTokens ?? 0),
          requestCount: Number(month?.requestCount ?? 0),
        },
        relay: {
          baseUrl: `${req.protocol}://${req.hostname}:${process.env.PORT ?? 3100}/v1`,
          note: "Authorization: Bearer <your employee API key>",
        },
      },
    };
  });

  app.get("/api/me/logs", async (req) => {
    const query = z
      .object({
        limit: z.coerce.number().min(1).max(100).default(20),
        offset: z.coerce.number().min(0).default(0),
      })
      .parse(req.query);

    const rows = await db
      .select({
        id: requestAudits.id,
        requestId: requestAudits.requestId,
        clientModel: requestAudits.clientModel,
        providerCode: requestAudits.providerCode,
        productType: requestAudits.productType,
        status: requestAudits.status,
        totalTokens: requestAudits.totalTokens,
        latencyMs: requestAudits.latencyMs,
        createdAt: requestAudits.createdAt,
      })
      .from(requestAudits)
      .where(eq(requestAudits.employeeId, req.employeeId!))
      .orderBy(desc(requestAudits.id))
      .limit(query.limit)
      .offset(query.offset);

    return { success: true, data: rows };
  });

  app.get("/api/me/logs/:requestId", async (req, reply) => {
    const params = z.object({ requestId: z.string().min(1) }).safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const [meta] = await db
      .select()
      .from(requestAudits)
      .where(
        and(
          eq(requestAudits.requestId, params.data.requestId),
          eq(requestAudits.employeeId, req.employeeId!),
        ),
      )
      .limit(1);

    if (!meta) {
      return reply.code(404).send({ success: false, message: "记录不存在" });
    }

    const [body] = await db
      .select()
      .from(requestAuditBodies)
      .where(eq(requestAuditBodies.requestId, params.data.requestId))
      .limit(1);

    return {
      success: true,
      data: {
        meta,
        body: body ?? null,
      },
    };
  });
}
