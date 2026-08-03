import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { employees, logAccessGrants } from "../../db/schema/index.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

export async function adminGrantRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin"));

  app.get("/api/admin/log-grants", async () => {
    const rows = await db
      .select({
        id: logAccessGrants.id,
        granteeEmployeeId: logAccessGrants.granteeEmployeeId,
        granteeName: employees.name,
        granteePhone: employees.phone,
        scopeType: logAccessGrants.scopeType,
        scopePayload: logAccessGrants.scopePayload,
        canReadBody: logAccessGrants.canReadBody,
        expiresAt: logAccessGrants.expiresAt,
        grantedBy: logAccessGrants.grantedBy,
        status: logAccessGrants.status,
        createdAt: logAccessGrants.createdAt,
      })
      .from(logAccessGrants)
      .innerJoin(employees, eq(logAccessGrants.granteeEmployeeId, employees.id))
      .orderBy(desc(logAccessGrants.id));

    return { success: true, data: rows };
  });

  app.post("/api/admin/log-grants", async (req, reply) => {
    const body = z
      .object({
        granteeEmployeeId: z.number().int().positive(),
        scopeType: z.enum(["all", "dept", "employees"]),
        scopePayload: z
          .object({
            employeeIds: z.array(z.number()).optional(),
            depts: z.array(z.string()).optional(),
          })
          .optional()
          .default({}),
        canReadBody: z.boolean().default(true),
        expiresAt: z.string().datetime().nullable().optional(),
      })
      .safeParse(req.body);

    if (!body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    if (body.data.scopeType === "employees" && !body.data.scopePayload.employeeIds?.length) {
      return reply.code(400).send({ success: false, message: "请指定员工列表" });
    }
    if (body.data.scopeType === "dept" && !body.data.scopePayload.depts?.length) {
      return reply.code(400).send({ success: false, message: "请指定部门列表" });
    }

    const [grantee] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(eq(employees.id, body.data.granteeEmployeeId))
      .limit(1);
    if (!grantee) {
      return reply.code(400).send({ success: false, message: "被授权人不存在" });
    }

    const [row] = await db
      .insert(logAccessGrants)
      .values({
        granteeEmployeeId: body.data.granteeEmployeeId,
        scopeType: body.data.scopeType,
        scopePayload: body.data.scopePayload,
        canReadBody: body.data.canReadBody,
        expiresAt: body.data.expiresAt ? new Date(body.data.expiresAt) : null,
        grantedBy: req.employeeId,
        status: "active",
      })
      .returning();

    await writeOpsAudit({
      actorEmployeeId: req.employeeId,
      action: "log_grant.create",
      targetType: "log_access_grant",
      targetId: String(row.id),
      detail: body.data,
      ip: req.ip,
    });

    return { success: true, data: row };
  });

  app.patch("/api/admin/log-grants/:id", async (req, reply) => {
    const params = z.object({ id: z.coerce.number() }).safeParse(req.params);
    const body = z
      .object({
        status: z.enum(["active", "revoked"]).optional(),
        canReadBody: z.boolean().optional(),
        expiresAt: z.string().datetime().nullable().optional(),
      })
      .safeParse(req.body);

    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const patch: Record<string, unknown> = {};
    if (body.data.status !== undefined) patch.status = body.data.status;
    if (body.data.canReadBody !== undefined) patch.canReadBody = body.data.canReadBody;
    if (body.data.expiresAt !== undefined) {
      patch.expiresAt = body.data.expiresAt ? new Date(body.data.expiresAt) : null;
    }

    const [row] = await db
      .update(logAccessGrants)
      .set(patch)
      .where(eq(logAccessGrants.id, params.data.id))
      .returning();

    if (!row) {
      return reply.code(404).send({ success: false, message: "授权不存在" });
    }

    await writeOpsAudit({
      actorEmployeeId: req.employeeId,
      action: "log_grant.update",
      targetType: "log_access_grant",
      targetId: String(row.id),
      detail: body.data,
      ip: req.ip,
    });

    return { success: true, data: row };
  });
}
