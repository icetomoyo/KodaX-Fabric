import type { FastifyInstance } from "fastify";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  employees,
  opsAuditLogs,
  requestAuditBodies,
  requestAudits,
} from "../../db/schema/index.js";
import { normalizeAuditContext } from "../../lib/audit-context.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

const CONTEXT_AUDIT_DEDUP_MS = 5 * 60_000;
export const requireAdminLogContext = requireRoles("admin");

export function contextAuditDedupSince(now: Date = new Date()): Date {
  return new Date(now.getTime() - CONTEXT_AUDIT_DEDUP_MS);
}

export async function adminLogRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin"));

  app.get("/api/admin/logs", async (req) => {
    const query = z
      .object({
        limit: z.coerce.number().min(1).max(200).default(50),
        offset: z.coerce.number().min(0).default(0),
        employeeId: z.coerce.number().optional(),
        model: z.string().optional(),
        providerCode: z.string().optional(),
        status: z.string().optional(),
        requestId: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse(req.query);

    const conditions = [];

    if (query.employeeId) {
      conditions.push(eq(requestAudits.employeeId, query.employeeId));
    }
    if (query.model) conditions.push(eq(requestAudits.clientModel, query.model));
    if (query.providerCode) conditions.push(eq(requestAudits.providerCode, query.providerCode));
    if (query.status) {
      conditions.push(eq(requestAudits.status, query.status as "success"));
    }
    if (query.requestId) conditions.push(eq(requestAudits.requestId, query.requestId));
    if (query.from) conditions.push(gte(requestAudits.createdAt, new Date(query.from)));
    if (query.to) conditions.push(lte(requestAudits.createdAt, new Date(query.to)));

    const whereExpr = conditions.length ? and(...conditions) : undefined;

    const [countRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(requestAudits)
      .where(whereExpr);

    const items = await db
      .select({
        id: requestAudits.id,
        requestId: requestAudits.requestId,
        employeeId: requestAudits.employeeId,
        employeeName: employees.name,
        employeePhone: employees.phone,
        protocol: requestAudits.protocol,
        clientModel: requestAudits.clientModel,
        upstreamModel: requestAudits.upstreamModel,
        providerCode: requestAudits.providerCode,
        productType: requestAudits.productType,
        credentialSuffix: requestAudits.credentialSuffix,
        isStream: requestAudits.isStream,
        status: requestAudits.status,
        httpStatus: requestAudits.httpStatus,
        promptTokens: requestAudits.promptTokens,
        completionTokens: requestAudits.completionTokens,
        totalTokens: requestAudits.totalTokens,
        latencyMs: requestAudits.latencyMs,
        ttftMs: requestAudits.ttftMs,
        retryCount: requestAudits.retryCount,
        errorCode: requestAudits.errorCode,
        errorMessage: requestAudits.errorMessage,
        createdAt: requestAudits.createdAt,
      })
      .from(requestAudits)
      .innerJoin(employees, eq(requestAudits.employeeId, employees.id))
      .where(whereExpr)
      .orderBy(desc(requestAudits.createdAt), desc(requestAudits.id))
      .limit(query.limit)
      .offset(query.offset);

    return {
      success: true,
      data: {
        total: countRow?.n ?? 0,
        items,
      },
    };
  });

  app.get("/api/admin/logs/:requestId", async (req, reply) => {
    const params = z.object({ requestId: z.string().min(1) }).safeParse(req.params);
    const query = z.object({}).strict().safeParse(req.query);

    if (!params.success || !query.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const [meta] = await db
      .select({
        audit: requestAudits,
        employeeName: employees.name,
        employeePhone: employees.phone,
        employeeDept: employees.dept,
      })
      .from(requestAudits)
      .innerJoin(employees, eq(requestAudits.employeeId, employees.id))
      .where(eq(requestAudits.requestId, params.data.requestId))
      .limit(1);

    if (!meta) {
      return reply.code(404).send({ success: false, message: "记录不存在" });
    }

    return {
      success: true,
      data: {
        meta: {
          ...meta.audit,
          employeeName: meta.employeeName,
          employeePhone: meta.employeePhone,
          employeeDept: meta.employeeDept,
        },
      },
    };
  });

  app.get(
    "/api/admin/logs/:requestId/context",
    { preHandler: [requireAdminLogContext] },
    async (req, reply) => {
      const params = z.object({ requestId: z.string().min(1).max(64) }).safeParse(req.params);
      if (!params.success) {
        return reply.code(400).send({ success: false, message: "参数无效" });
      }

      const [row] = await db
        .select({
          requestId: requestAudits.requestId,
          employeeId: requestAudits.employeeId,
          employeePhone: employees.phone,
          protocol: requestAudits.protocol,
          clientModel: requestAudits.clientModel,
          upstreamModel: requestAudits.upstreamModel,
          requestBody: requestAuditBodies.requestBody,
          responseBody: requestAuditBodies.responseBody,
          requestBodySize: requestAuditBodies.requestBodySize,
          responseBodySize: requestAuditBodies.responseBodySize,
          truncated: requestAuditBodies.truncated,
        })
        .from(requestAudits)
        .innerJoin(employees, eq(requestAudits.employeeId, employees.id))
        .leftJoin(requestAuditBodies, eq(requestAudits.requestId, requestAuditBodies.requestId))
        .where(eq(requestAudits.requestId, params.data.requestId))
        .limit(1);
      if (!row) {
        return reply.code(404).send({ success: false, message: "记录不存在" });
      }

      const dedupSince = contextAuditDedupSince();
      const actorEmployeeId = req.employeeId!;
      await db.transaction(async (tx) => {
        const lockKey = `${actorEmployeeId}:${row.requestId}`;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
        const [recentRead] = await tx
          .select({ id: opsAuditLogs.id })
          .from(opsAuditLogs)
          .where(and(
            eq(opsAuditLogs.actorEmployeeId, actorEmployeeId),
            eq(opsAuditLogs.action, "log.read_context"),
            eq(opsAuditLogs.targetId, row.requestId),
            gte(opsAuditLogs.createdAt, dedupSince),
          ))
          .limit(1);
        if (!recentRead) {
          await tx.insert(opsAuditLogs).values({
            actorEmployeeId,
            action: "log.read_context",
            targetType: "request_audit",
            targetId: row.requestId,
            detail: {
              ownerEmployeeId: row.employeeId,
              ownerPhone: row.employeePhone,
            },
            ip: req.ip,
          });
        }
      });

      return {
        success: true,
        data: normalizeAuditContext({
          requestId: row.requestId,
          protocol: row.protocol,
          clientModel: row.clientModel,
          upstreamModel: row.upstreamModel,
          requestBody: row.requestBody,
          responseBody: row.responseBody,
          requestBodySize: row.requestBodySize,
          responseBodySize: row.responseBodySize,
          truncated: row.truncated ?? false,
        }),
      };
    },
  );
}
