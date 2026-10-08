import type { FastifyInstance } from "fastify";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { employees, enterprises } from "../../db/schema/index.js";
import { enterpriseColumns, ORG_UNITS_SYNC_ONLY_MESSAGE, SUPER_ADMIN_ROLE } from "../../lib/enterprise.js";
import {
  dingtalkDeptIdConflictMessage,
  findDingtalkDeptIdOwner,
  loadEnterpriseParentChain,
} from "../../lib/dingtalk-dept-id.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import {
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

export function buildEnterpriseListQuery() {
  return db
    .select(enterpriseColumns)
    .from(enterprises)
    .orderBy(enterprises.id);
}

const dingtalkDeptIdSchema = z.number().int().positive().nullable();

const updateEnterpriseSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    status: z.enum(["active", "disabled"]).optional(),
    parentId: z.number().int().positive().nullable().optional(),
    dingtalkDeptId: dingtalkDeptIdSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0);

async function assertParentEnterprise(parentId: number | null | undefined, childId?: number) {
  if (parentId == null) return;
  if (childId != null && parentId === childId) {
    return { error: "上级企业不能是自己", status: 400 as const };
  }
  const [parent] = await db
    .select({ id: enterprises.id })
    .from(enterprises)
    .where(eq(enterprises.id, parentId))
    .limit(1);
  if (!parent) return { error: "上级企业不存在", status: 400 as const };
  if (childId != null) {
    const chain = await loadEnterpriseParentChain(parentId);
    if (chain.includes(childId)) {
      return { error: "上级企业不能选自己的下级", status: 400 as const };
    }
  }
  return;
}

async function assertDingtalkDeptIdAvailable(
  dingtalkDeptId: number | null | undefined,
  except?: { enterpriseId?: number },
) {
  if (dingtalkDeptId == null) return;
  const owner = await findDingtalkDeptIdOwner(dingtalkDeptId, except);
  if (owner) return { error: dingtalkDeptIdConflictMessage(owner), status: 409 as const };
  return;
}

export async function adminEnterpriseRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
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
          employeeCount: people.filter((person) => person.role !== SUPER_ADMIN_ROLE).length,
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

  app.post("/api/admin/enterprises", async (_req, reply) => {
    return reply.code(403).send({ success: false, message: ORG_UNITS_SYNC_ONLY_MESSAGE });
  });

  app.patch("/api/admin/enterprises/:id", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    const body = updateEnterpriseSchema.safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const parentError = await assertParentEnterprise(body.data.parentId, params.data.id);
    if (parentError) return reply.code(parentError.status).send({ success: false, message: parentError.error });
    const dingError = await assertDingtalkDeptIdAvailable(body.data.dingtalkDeptId, {
      enterpriseId: params.data.id,
    });
    if (dingError) return reply.code(dingError.status).send({ success: false, message: dingError.error });

    try {
      const [row] = await db
        .update(enterprises)
        .set({
          ...body.data,
          updatedAt: new Date(),
        })
        .where(eq(enterprises.id, params.data.id))
        .returning(enterpriseColumns);

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
          parentId: row.parentId,
          dingtalkDeptId: row.dingtalkDeptId,
        },
        ip: req.ip,
      });

      return { success: true, data: row };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("enterprises_dingtalk_dept_id_uidx")) {
        return reply.code(409).send({ success: false, message: "钉钉部门 ID 已存在" });
      }
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
