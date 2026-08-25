import type { FastifyInstance } from "fastify";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { employees, enterprises, teams } from "../../db/schema/index.js";
import { insertEnterprise } from "../../lib/enterprise.js";
import { packageMonthlyYuan, parseYuanNumber } from "../../lib/enterprise-package.js";
import { sumAssignedTeamQuota } from "../../lib/team-quota.js";
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
      packagePlan: enterprises.packagePlan,
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
    packagePlan: z.enum(["plus", "pro", "max"]).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0);

export async function adminEnterpriseRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin"));

  app.get("/api/admin/enterprises", async () => {
    const rows = await buildEnterpriseListQuery();
    const ids = rows.map((row) => row.id);
    const contacts = ids.length
      ? await db
          .select({
            id: employees.id,
            enterpriseId: employees.enterpriseId,
            name: employees.name,
            phone: employees.phone,
            role: employees.role,
            createdAt: employees.createdAt,
          })
          .from(employees)
          .where(inArray(employees.enterpriseId, ids))
      : [];
    const byEnterprise = new Map<number, typeof contacts>();
    for (const person of contacts) {
      if (person.enterpriseId == null) continue;
      const list = byEnterprise.get(person.enterpriseId) ?? [];
      list.push(person);
      byEnterprise.set(person.enterpriseId, list);
    }
    const assignedRows = ids.length
      ? await db
          .select({
            enterpriseId: teams.enterpriseId,
            total: sql<string>`coalesce(sum(${teams.monthlyYuanQuota}), 0)`,
          })
          .from(teams)
          .where(inArray(teams.enterpriseId, ids))
          .groupBy(teams.enterpriseId)
      : [];
    const assignedByEnterprise = new Map(
      assignedRows.map((row) => [row.enterpriseId, parseYuanNumber(row.total)]),
    );
    return {
      success: true,
      data: rows.map((row) => {
        const people = byEnterprise.get(row.id) ?? [];
        const contact =
          people.find((person) => person.role === "org_admin") ??
          [...people].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ??
          null;
        return {
          ...row,
          monthlyYuan: packageMonthlyYuan(row.packagePlan),
          assignedTeamQuota: assignedByEnterprise.get(row.id) ?? 0,
          contact: contact
            ? {
                employeeId: contact.id,
                name: contact.name,
                phone: contact.phone,
                role: contact.role,
              }
            : null,
        };
      }),
    };
  });

  app.get("/api/admin/enterprises/:id/teams", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const rows = await db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(eq(teams.enterpriseId, params.data.id))
      .orderBy(teams.name);
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
      if (body.data.packagePlan !== undefined) {
        const assigned = await sumAssignedTeamQuota(params.data.id);
        const nextYuan = packageMonthlyYuan(body.data.packagePlan);
        if (assigned > nextYuan) {
          return reply.code(400).send({
            success: false,
            message: "已分配给团队的额度超过该套餐，请先下调团队额度",
          });
        }
      }
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
          packagePlan: enterprises.packagePlan,
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
        detail: {
          fields: Object.keys(body.data),
          name: row.name,
          status: row.status,
          packagePlan: row.packagePlan,
          monthlyYuan: packageMonthlyYuan(row.packagePlan),
        },
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

    const [current] = await db
      .select({ id: enterprises.id, status: enterprises.status })
      .from(enterprises)
      .where(eq(enterprises.id, params.data.id))
      .limit(1);
    if (!current) {
      return reply.code(404).send({ success: false, message: "企业不存在" });
    }
    if (current.status === "pending" && body.data.status === "active") {
      return reply.code(400).send({ success: false, message: "待审核企业请使用“审核通过”" });
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

  app.post("/api/admin/enterprises/:id/approve", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const result = await db.transaction(async (tx) => {
      const [enterprise] = await tx
        .select({
          id: enterprises.id,
          name: enterprises.name,
          code: enterprises.code,
          status: enterprises.status,
        })
        .from(enterprises)
        .where(eq(enterprises.id, params.data.id))
        .limit(1)
        .for("update");
      if (!enterprise) return { outcome: "not_found" } as const;
      if (enterprise.status !== "pending") return { outcome: "not_pending" } as const;

      const [applicant] = await tx
        .select({
          id: employees.id,
          role: employees.role,
          status: employees.status,
        })
        .from(employees)
        .where(eq(employees.enterpriseId, enterprise.id))
        .orderBy(asc(employees.createdAt), asc(employees.id))
        .limit(1)
        .for("update");

      const [row] = await tx
        .update(enterprises)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(enterprises.id, enterprise.id))
        .returning({
          id: enterprises.id,
          name: enterprises.name,
          code: enterprises.code,
          status: enterprises.status,
        });

      if (applicant && (applicant.role === "employee" || applicant.status === "pending")) {
        await tx
          .update(employees)
          .set({
            role: "org_admin",
            status: "active",
            updatedAt: new Date(),
          })
          .where(eq(employees.id, applicant.id));
      }

      return {
        outcome: "approved" as const,
        row,
        applicantId: applicant?.id ?? null,
      };
    });

    if (result.outcome === "not_found") {
      return reply.code(404).send({ success: false, message: "企业不存在" });
    }
    if (result.outcome === "not_pending") {
      return reply.code(409).send({ success: false, message: "该企业已审核" });
    }

    await writeOpsAudit({
      actorEmployeeId: req.employeeId,
      action: "enterprise.approve",
      targetType: "enterprise",
      targetId: String(result.row.id),
      detail: {
        name: result.row.name,
        code: result.row.code,
        applicantId: result.applicantId,
      },
      ip: req.ip,
    });

    return { success: true, data: result.row };
  });
}
