import type { FastifyInstance } from "fastify";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  employees,
  requestAuditBodies,
  requestAudits,
} from "../../db/schema/index.js";
import {
  canAccessEmployeeLogs,
  listAccessibleEmployeeFilter,
} from "../../lib/log-access.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

export async function adminLogRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin", "auditor"));

  app.get("/api/admin/logs", async (req, reply) => {
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

    const subject = {
      employeeId: req.employeeId!,
      role: req.session!.role,
    };

    const scope = await listAccessibleEmployeeFilter(subject);
    if (!scope.all && (scope.employeeIds?.length === 0 && scope.depts.length === 0)) {
      return { success: true, data: { total: 0, items: [] } };
    }

    const conditions = [];

    if (query.employeeId) {
      const access = await canAccessEmployeeLogs(subject, query.employeeId);
      if (!access.allowed) {
        return reply.code(403).send({ success: false, message: "无权查看该员工日志" });
      }
      conditions.push(eq(requestAudits.employeeId, query.employeeId));
    } else if (!scope.all) {
      // Filter by granted employee ids and depts
      const deptIds: number[] = [];
      if (scope.depts.length) {
        const deptEmployees = await db
          .select({ id: employees.id })
          .from(employees)
          .where(inArray(employees.dept, scope.depts));
        deptIds.push(...deptEmployees.map((e) => e.id));
      }
      const ids = new Set([...(scope.employeeIds ?? []), ...deptIds]);
      if (ids.size === 0) {
        return { success: true, data: { total: 0, items: [] } };
      }
      conditions.push(inArray(requestAudits.employeeId, [...ids]));
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
    const query = z
      .object({
        includeBody: z
          .enum(["true", "false"])
          .default("false")
          .transform((v) => v === "true"),
      })
      .parse(req.query);

    if (!params.success) {
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

    const subject = {
      employeeId: req.employeeId!,
      role: req.session!.role,
    };
    const access = await canAccessEmployeeLogs(subject, meta.audit.employeeId);
    if (!access.allowed) {
      return reply.code(403).send({ success: false, message: "无权查看该记录" });
    }

    let body: typeof requestAuditBodies.$inferSelect | null = null;
    if (query.includeBody) {
      if (!access.canReadBody) {
        return reply.code(403).send({ success: false, message: "无权查看对话正文" });
      }
      const [b] = await db
        .select()
        .from(requestAuditBodies)
        .where(eq(requestAuditBodies.requestId, params.data.requestId))
        .limit(1);
      body = b ?? null;

      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "log.read_body",
        targetType: "request_audit",
        targetId: params.data.requestId,
        detail: {
          ownerEmployeeId: meta.audit.employeeId,
          ownerPhone: meta.employeePhone,
        },
        ip: req.ip,
      });
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
        body,
        canReadBody: access.canReadBody,
      },
    };
  });
}
