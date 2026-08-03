import type { FastifyInstance } from "fastify";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { employees } from "../../db/schema/index.js";
import { hashPassword, validateNewPassword } from "../../lib/password.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().min(5).max(20),
  password: z.string().min(8),
  dept: z.string().max(100).optional().nullable(),
  role: z.enum(["employee", "admin", "auditor"]).default("employee"),
});

export async function adminUserRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin"));

  app.get("/api/admin/users", async (req) => {
    const query = z
      .object({
        limit: z.coerce.number().min(1).max(200).default(50),
        offset: z.coerce.number().min(0).default(0),
        q: z.string().optional(),
      })
      .parse(req.query);

    const rows = await db
      .select({
        id: employees.id,
        name: employees.name,
        phone: employees.phone,
        dept: employees.dept,
        role: employees.role,
        status: employees.status,
        mustChangePassword: employees.mustChangePassword,
        lastLoginAt: employees.lastLoginAt,
        createdAt: employees.createdAt,
      })
      .from(employees)
      .where(
        query.q
          ? sql`(${employees.name} ilike ${"%" + query.q + "%"} or ${employees.phone} ilike ${"%" + query.q + "%"})`
          : sql`true`,
      )
      .orderBy(desc(employees.id))
      .limit(query.limit)
      .offset(query.offset);

    return { success: true, data: rows };
  });

  app.post("/api/admin/users", async (req, reply) => {
    const body = createUserSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ success: false, message: "参数无效", errors: body.error.flatten() });
    }
    const policy = validateNewPassword(body.data.password);
    if (policy) {
      return reply.code(400).send({ success: false, message: policy });
    }

    try {
      const passwordHash = await hashPassword(body.data.password);
      const [row] = await db
        .insert(employees)
        .values({
          name: body.data.name,
          phone: body.data.phone,
          passwordHash,
          dept: body.data.dept ?? null,
          role: body.data.role,
          mustChangePassword: true,
          createdBy: req.employeeId,
        })
        .returning({
          id: employees.id,
          name: employees.name,
          phone: employees.phone,
          role: employees.role,
          status: employees.status,
        });

      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "user.create",
        targetType: "employee",
        targetId: String(row.id),
        detail: { phone: row.phone, role: row.role },
        ip: req.ip,
      });

      return { success: true, data: row };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("employees_phone_uidx") || msg.includes("unique")) {
        return reply.code(409).send({ success: false, message: "手机号已存在" });
      }
      throw e;
    }
  });

  app.post("/api/admin/users/import", async (req, reply) => {
    const body = z
      .object({
        users: z.array(createUserSchema).min(1).max(500),
      })
      .safeParse(req.body);

    if (!body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const results: Array<{ phone: string; ok: boolean; error?: string; id?: number }> = [];

    for (const u of body.data.users) {
      const policy = validateNewPassword(u.password);
      if (policy) {
        results.push({ phone: u.phone, ok: false, error: policy });
        continue;
      }
      try {
        const passwordHash = await hashPassword(u.password);
        const [row] = await db
          .insert(employees)
          .values({
            name: u.name,
            phone: u.phone,
            passwordHash,
            dept: u.dept ?? null,
            role: u.role,
            mustChangePassword: true,
            createdBy: req.employeeId,
          })
          .returning({ id: employees.id });
        results.push({ phone: u.phone, ok: true, id: row.id });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({
          phone: u.phone,
          ok: false,
          error: msg.includes("unique") ? "手机号已存在" : msg,
        });
      }
    }

    const success = results.filter((r) => r.ok).length;
    await writeOpsAudit({
      actorEmployeeId: req.employeeId,
      action: "user.import",
      targetType: "employee",
      detail: { total: results.length, success, failed: results.length - success },
      ip: req.ip,
    });

    return {
      success: true,
      data: {
        total: results.length,
        success,
        failed: results.length - success,
        results,
      },
    };
  });

  app.patch("/api/admin/users/:id/status", async (req, reply) => {
    const params = z.object({ id: z.coerce.number() }).safeParse(req.params);
    const body = z.object({ status: z.enum(["active", "disabled"]) }).safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    if (params.data.id === req.employeeId && body.data.status === "disabled") {
      return reply.code(400).send({ success: false, message: "不能停用自己" });
    }

    const [row] = await db
      .update(employees)
      .set({ status: body.data.status, updatedAt: new Date() })
      .where(eq(employees.id, params.data.id))
      .returning({ id: employees.id, status: employees.status });

    if (!row) {
      return reply.code(404).send({ success: false, message: "用户不存在" });
    }

    await writeOpsAudit({
      actorEmployeeId: req.employeeId,
      action: "user.status",
      targetType: "employee",
      targetId: String(row.id),
      detail: { status: row.status },
      ip: req.ip,
    });

    return { success: true, data: row };
  });
}
