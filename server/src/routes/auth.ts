import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { employees } from "../db/schema/index.js";
import { isSessionRole, signSession } from "../lib/jwt.js";
import { hashPassword, validateNewPassword, verifyPassword } from "../lib/password.js";
import { writeOpsAudit } from "../lib/ops-audit.js";
import { requireSession } from "../middleware/auth.js";

function publicEmployee(row: typeof employees.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    dept: row.dept,
    role: row.role,
    status: row.status,
    mustChangePassword: row.mustChangePassword,
    lastLoginAt: row.lastLoginAt,
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/login", async (req, reply) => {
    const body = z
      .object({
        phone: z.string().min(5).max(20),
        password: z.string().min(1),
      })
      .safeParse(req.body);

    if (!body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const [user] = await db
      .select()
      .from(employees)
      .where(eq(employees.phone, body.data.phone))
      .limit(1);

    if (!user || user.status !== "active" || !isSessionRole(user.role)) {
      return reply.code(401).send({ success: false, message: "手机号或密码错误" });
    }

    const ok = await verifyPassword(body.data.password, user.passwordHash);
    if (!ok) {
      return reply.code(401).send({ success: false, message: "手机号或密码错误" });
    }

    await db
      .update(employees)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(employees.id, user.id));

    const token = await signSession({
      sub: String(user.id),
      role: user.role,
      phone: user.phone,
      name: user.name,
      mustChangePassword: user.mustChangePassword,
    });

    await writeOpsAudit({
      actorEmployeeId: user.id,
      action: "auth.login",
      targetType: "employee",
      targetId: String(user.id),
      ip: req.ip,
    });

    return {
      success: true,
      data: {
        token,
        user: publicEmployee(user),
      },
    };
  });

  app.get("/api/auth/me", { preHandler: [requireSession] }, async (req, reply) => {
    const [user] = await db
      .select()
      .from(employees)
      .where(eq(employees.id, req.employeeId!))
      .limit(1);
    if (!user || user.status !== "active") {
      return reply.code(401).send({ success: false, message: "用户不可用" });
    }
    return { success: true, data: publicEmployee(user) };
  });

  app.post(
    "/api/auth/change-password",
    { preHandler: [requireSession] },
    async (req, reply) => {
      const body = z
        .object({
          oldPassword: z.string().min(1),
          newPassword: z.string().min(8).max(128),
        })
        .safeParse(req.body);

      if (!body.success) {
        return reply.code(400).send({ success: false, message: "参数无效" });
      }

      const policy = validateNewPassword(body.data.newPassword);
      if (policy) {
        return reply.code(400).send({ success: false, message: policy });
      }

      const [user] = await db
        .select()
        .from(employees)
        .where(eq(employees.id, req.employeeId!))
        .limit(1);

      if (!user || !isSessionRole(user.role)) {
        return reply.code(401).send({ success: false, message: "用户不存在" });
      }

      const ok = await verifyPassword(body.data.oldPassword, user.passwordHash);
      if (!ok) {
        return reply.code(400).send({ success: false, message: "原密码错误" });
      }

      if (body.data.oldPassword === body.data.newPassword) {
        return reply.code(400).send({ success: false, message: "新密码不能与原密码相同" });
      }

      const passwordHash = await hashPassword(body.data.newPassword);
      await db
        .update(employees)
        .set({
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(employees.id, user.id));

      const token = await signSession({
        sub: String(user.id),
        role: user.role,
        phone: user.phone,
        name: user.name,
        mustChangePassword: false,
      });

      await writeOpsAudit({
        actorEmployeeId: user.id,
        action: "auth.change_password",
        targetType: "employee",
        targetId: String(user.id),
        ip: req.ip,
      });

      return {
        success: true,
        data: {
          token,
          user: {
            ...publicEmployee(user),
            mustChangePassword: false,
          },
        },
      };
    },
  );
}
