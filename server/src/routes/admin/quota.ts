import type { FastifyInstance } from "fastify";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  employeeQuotaOverrides,
  employees,
  quotaPolicies,
} from "../../db/schema/index.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

export async function adminQuotaRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin"));

  app.get("/api/admin/quota-policies", async () => {
    const rows = await db.select().from(quotaPolicies).orderBy(asc(quotaPolicies.id));
    return { success: true, data: rows };
  });

  app.post("/api/admin/quota-policies", async (req, reply) => {
    const body = z
      .object({
        name: z.string().min(1).max(100),
        softTpmDay: z.number().int().nullable().optional(),
        hardTpmDay: z.number().int().nullable().optional(),
        rpm: z.number().int().min(1).default(60),
        maxConcurrency: z.number().int().min(1).default(5),
        softReqDay: z.number().int().nullable().optional(),
        hardReqDay: z.number().int().nullable().optional(),
        isDefault: z.boolean().default(false),
      })
      .safeParse(req.body);

    if (!body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    if (body.data.isDefault) {
      await db.update(quotaPolicies).set({ isDefault: false });
    }

    const [row] = await db.insert(quotaPolicies).values(body.data).returning();

    await writeOpsAudit({
      actorEmployeeId: req.employeeId,
      action: "quota_policy.create",
      targetType: "quota_policy",
      targetId: String(row.id),
      detail: body.data,
      ip: req.ip,
    });

    return { success: true, data: row };
  });

  app.patch("/api/admin/quota-policies/:id", async (req, reply) => {
    const params = z.object({ id: z.coerce.number() }).safeParse(req.params);
    const body = z
      .object({
        name: z.string().min(1).max(100).optional(),
        softTpmDay: z.number().int().nullable().optional(),
        hardTpmDay: z.number().int().nullable().optional(),
        rpm: z.number().int().min(1).optional(),
        maxConcurrency: z.number().int().min(1).optional(),
        softReqDay: z.number().int().nullable().optional(),
        hardReqDay: z.number().int().nullable().optional(),
        isDefault: z.boolean().optional(),
      })
      .safeParse(req.body);

    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    if (body.data.isDefault) {
      await db.update(quotaPolicies).set({ isDefault: false });
    }

    const [row] = await db
      .update(quotaPolicies)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(quotaPolicies.id, params.data.id))
      .returning();

    if (!row) {
      return reply.code(404).send({ success: false, message: "策略不存在" });
    }

    await writeOpsAudit({
      actorEmployeeId: req.employeeId,
      action: "quota_policy.update",
      targetType: "quota_policy",
      targetId: String(row.id),
      detail: body.data,
      ip: req.ip,
    });

    return { success: true, data: row };
  });

  app.get("/api/admin/quota-overrides", async () => {
    const rows = await db
      .select({
        employeeId: employeeQuotaOverrides.employeeId,
        employeeName: employees.name,
        employeePhone: employees.phone,
        policyId: employeeQuotaOverrides.policyId,
        policyName: quotaPolicies.name,
        softTpmDay: employeeQuotaOverrides.softTpmDay,
        hardTpmDay: employeeQuotaOverrides.hardTpmDay,
        rpm: employeeQuotaOverrides.rpm,
        maxConcurrency: employeeQuotaOverrides.maxConcurrency,
        updatedAt: employeeQuotaOverrides.updatedAt,
      })
      .from(employeeQuotaOverrides)
      .innerJoin(employees, eq(employeeQuotaOverrides.employeeId, employees.id))
      .leftJoin(quotaPolicies, eq(employeeQuotaOverrides.policyId, quotaPolicies.id))
      .orderBy(asc(employeeQuotaOverrides.employeeId));

    return { success: true, data: rows };
  });

  app.put("/api/admin/quota-overrides/:employeeId", async (req, reply) => {
    const params = z.object({ employeeId: z.coerce.number() }).safeParse(req.params);
    const body = z
      .object({
        policyId: z.number().int().positive().nullable().optional(),
        softTpmDay: z.number().int().nullable().optional(),
        hardTpmDay: z.number().int().nullable().optional(),
        rpm: z.number().int().min(1).nullable().optional(),
        maxConcurrency: z.number().int().min(1).nullable().optional(),
      })
      .safeParse(req.body);

    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const [emp] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(eq(employees.id, params.data.employeeId))
      .limit(1);
    if (!emp) {
      return reply.code(404).send({ success: false, message: "员工不存在" });
    }

    const [existing] = await db
      .select()
      .from(employeeQuotaOverrides)
      .where(eq(employeeQuotaOverrides.employeeId, params.data.employeeId))
      .limit(1);

    let row;
    if (existing) {
      [row] = await db
        .update(employeeQuotaOverrides)
        .set({ ...body.data, updatedAt: new Date() })
        .where(eq(employeeQuotaOverrides.employeeId, params.data.employeeId))
        .returning();
    } else {
      [row] = await db
        .insert(employeeQuotaOverrides)
        .values({
          employeeId: params.data.employeeId,
          ...body.data,
        })
        .returning();
    }

    await writeOpsAudit({
      actorEmployeeId: req.employeeId,
      action: "quota_override.upsert",
      targetType: "employee",
      targetId: String(params.data.employeeId),
      detail: body.data,
      ip: req.ip,
    });

    return { success: true, data: row };
  });

  app.delete("/api/admin/quota-overrides/:employeeId", async (req, reply) => {
    const params = z.object({ employeeId: z.coerce.number() }).safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    await db
      .delete(employeeQuotaOverrides)
      .where(eq(employeeQuotaOverrides.employeeId, params.data.employeeId));

    await writeOpsAudit({
      actorEmployeeId: req.employeeId,
      action: "quota_override.delete",
      targetType: "employee",
      targetId: String(params.data.employeeId),
      ip: req.ip,
    });

    return { success: true };
  });
}
