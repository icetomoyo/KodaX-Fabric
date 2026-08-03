import type { FastifyInstance } from "fastify";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { employees, opsAuditLogs } from "../../db/schema/index.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

export async function adminOpsAuditRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin"));

  app.get("/api/admin/ops-audit", async (req) => {
    const query = z
      .object({
        limit: z.coerce.number().min(1).max(200).default(50),
        offset: z.coerce.number().min(0).default(0),
        action: z.string().optional(),
        actorEmployeeId: z.coerce.number().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse(req.query);

    const conditions = [];
    if (query.action) conditions.push(eq(opsAuditLogs.action, query.action));
    if (query.actorEmployeeId) {
      conditions.push(eq(opsAuditLogs.actorEmployeeId, query.actorEmployeeId));
    }
    if (query.from) conditions.push(gte(opsAuditLogs.createdAt, new Date(query.from)));
    if (query.to) conditions.push(lte(opsAuditLogs.createdAt, new Date(query.to)));

    const whereExpr = conditions.length ? and(...conditions) : undefined;

    const [countRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(opsAuditLogs)
      .where(whereExpr);

    const items = await db
      .select({
        id: opsAuditLogs.id,
        actorEmployeeId: opsAuditLogs.actorEmployeeId,
        actorName: employees.name,
        actorPhone: employees.phone,
        action: opsAuditLogs.action,
        targetType: opsAuditLogs.targetType,
        targetId: opsAuditLogs.targetId,
        detail: opsAuditLogs.detail,
        ip: opsAuditLogs.ip,
        createdAt: opsAuditLogs.createdAt,
      })
      .from(opsAuditLogs)
      .leftJoin(employees, eq(opsAuditLogs.actorEmployeeId, employees.id))
      .where(whereExpr)
      .orderBy(desc(opsAuditLogs.id))
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
}
