import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { employeeApiKeys, employees, enterprises } from "../../db/schema/index.js";
import { insertEnterprise } from "../../lib/enterprise.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

export function buildEnterpriseListQuery() {
  return db
    .select({
      id: enterprises.id,
      name: enterprises.name,
      code: enterprises.code,
      status: enterprises.status,
      createdAt: enterprises.createdAt,
      updatedAt: enterprises.updatedAt,
    })
    .from(enterprises)
    .orderBy(desc(enterprises.id));
}

const createEnterpriseSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

const updateEnterpriseSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    status: z.enum(["active", "disabled"]).optional(),
  })
  .refine((data) => Object.keys(data).length > 0);

export async function adminEnterpriseRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin"));

  app.get("/api/admin/enterprises", async () => {
    const rows = await buildEnterpriseListQuery();
    return { success: true, data: rows };
  });

  app.post("/api/admin/enterprises", async (req, reply) => {
    const body = createEnterpriseSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    try {
      const row = await insertEnterprise({
        name: body.data.name,
        status: "active",
      });

      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "enterprise.create",
        targetType: "enterprise",
        targetId: String(row.id),
        detail: { name: row.name, code: row.code, status: row.status },
        ip: req.ip,
      });

      return { success: true, data: row };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("enterprises_name_uidx") || msg.includes("unique")) {
        return reply.code(409).send({ success: false, message: "企业名称已存在" });
      }
      throw e;
    }
  });

  app.patch("/api/admin/enterprises/:id", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    const body = updateEnterpriseSchema.safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    try {
      const [row] = await db
        .update(enterprises)
        .set({
          ...body.data,
          updatedAt: new Date(),
        })
        .where(eq(enterprises.id, params.data.id))
        .returning({
          id: enterprises.id,
          name: enterprises.name,
          code: enterprises.code,
          status: enterprises.status,
          createdAt: enterprises.createdAt,
          updatedAt: enterprises.updatedAt,
        });

      if (!row) {
        return reply.code(404).send({ success: false, message: "企业不存在" });
      }

      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "enterprise.update",
        targetType: "enterprise",
        targetId: String(row.id),
        detail: { fields: Object.keys(body.data), name: row.name, status: row.status },
        ip: req.ip,
      });

      return { success: true, data: row };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("enterprises_name_uidx") || msg.includes("unique")) {
        return reply.code(409).send({ success: false, message: "企业名称已存在" });
      }
      throw e;
    }
  });

  app.patch("/api/admin/enterprises/:id/status", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    const body = z.object({ status: z.enum(["active", "disabled"]) }).safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const [row] = await db
      .update(enterprises)
      .set({ status: body.data.status, updatedAt: new Date() })
      .where(eq(enterprises.id, params.data.id))
      .returning({
        id: enterprises.id,
        name: enterprises.name,
        code: enterprises.code,
        status: enterprises.status,
      });

    if (!row) {
      return reply.code(404).send({ success: false, message: "企业不存在" });
    }

    if (body.data.status === "active") {
      await db
        .update(employees)
        .set({ status: "active", updatedAt: new Date() })
        .where(and(eq(employees.enterpriseId, row.id), eq(employees.status, "pending")));
    }

    await writeOpsAudit({
      actorEmployeeId: req.employeeId,
      action: "enterprise.status",
      targetType: "enterprise",
      targetId: String(row.id),
      detail: { name: row.name, code: row.code, status: row.status },
      ip: req.ip,
    });

    return { success: true, data: row };
  });

  app.post("/api/admin/enterprises/:id/admins", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    const body = z.object({ employeeId: z.number().int().positive() }).safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const [enterprise] = await db
      .select({ id: enterprises.id, name: enterprises.name, status: enterprises.status })
      .from(enterprises)
      .where(eq(enterprises.id, params.data.id))
      .limit(1);
    if (!enterprise) {
      return reply.code(404).send({ success: false, message: "企业不存在" });
    }

    const result = await db.transaction(async (tx) => {
        const [target] = await tx
          .select({
            id: employees.id,
            role: employees.role,
            status: employees.status,
            enterpriseId: employees.enterpriseId,
          })
          .from(employees)
          .where(eq(employees.id, body.data.employeeId))
          .limit(1)
          .for("update");

        if (!target) return { outcome: "not_found" } as const;
        if (target.status === "pending") return { outcome: "pending_review" } as const;
        if (target.role === "admin") return { outcome: "super_admin" } as const;
        if (target.id === req.employeeId) return { outcome: "self" } as const;

        const [row] = await tx
          .update(employees)
          .set({
            role: "org_admin",
            enterpriseId: enterprise.id,
            updatedAt: new Date(),
          })
          .where(eq(employees.id, target.id))
          .returning({
            id: employees.id,
            name: employees.name,
            phone: employees.phone,
            role: employees.role,
            status: employees.status,
            enterpriseId: employees.enterpriseId,
          });

        let revokedApiKeyCount = 0;
        if (target.role === "employee") {
          const revokedKeys = await tx
            .update(employeeApiKeys)
            .set({ status: "revoked" })
            .where(
              and(
                eq(employeeApiKeys.employeeId, target.id),
                eq(employeeApiKeys.status, "active"),
              ),
            )
            .returning({ id: employeeApiKeys.id });
          revokedApiKeyCount = revokedKeys.length;
        }

        return { outcome: "assigned", row, previousRole: target.role, revokedApiKeyCount } as const;
      });

      if (result.outcome === "not_found") {
        return reply.code(404).send({ success: false, message: "用户不存在" });
      }
      if (result.outcome === "pending_review") {
        return reply.code(400).send({ success: false, message: "待审核注册申请请使用“审核通过”操作" });
      }
      if (result.outcome === "super_admin") {
        return reply.code(400).send({ success: false, message: "不能将超级管理员改为企业管理员" });
      }
      if (result.outcome === "self") {
        return reply.code(400).send({ success: false, message: "不能修改自己的角色或状态" });
      }

      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "enterprise.assign_admin",
        targetType: "enterprise",
        targetId: String(enterprise.id),
        detail: {
          employeeId: result.row.id,
          previousRole: result.previousRole,
          role: result.row.role,
          revokedApiKeyCount: result.revokedApiKeyCount,
        },
        ip: req.ip,
      });

      return { success: true, data: result.row };
  });
}
