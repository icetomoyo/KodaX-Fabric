import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { employees, enterprises } from "../db/schema/index.js";
import { isSessionRole, signSession } from "../lib/jwt.js";
import {
  hashPassword,
  validateNewPassword,
  verifyPassword,
} from "../lib/password.js";
import { writeOpsAudit } from "../lib/ops-audit.js";
import { requireSession } from "../middleware/auth.js";

function publicEmployee(
  row: typeof employees.$inferSelect,
  enterprise?: { id: number; name: string; code: string; status: string } | null,
) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    dept: row.dept,
    role: row.role,
    status: row.status,
    enterpriseId: row.enterpriseId,
    enterprise: enterprise
      ? {
          id: enterprise.id,
          name: enterprise.name,
          code: enterprise.code,
          status: enterprise.status,
        }
      : null,
    mustChangePassword: row.mustChangePassword,
    lastLoginAt: row.lastLoginAt,
  };
}

async function loadEnterprise(enterpriseId: number | null) {
  if (enterpriseId == null) return null;
  const [enterprise] = await db
    .select({
      id: enterprises.id,
      name: enterprises.name,
      code: enterprises.code,
      status: enterprises.status,
    })
    .from(enterprises)
    .where(eq(enterprises.id, enterpriseId))
    .limit(1);
  return enterprise ?? null;
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/register", async (req, reply) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(100),
        phone: z.string().trim().min(5).max(20),
        password: z.string().min(1).max(128),
      })
      .safeParse(req.body);

    if (!body.success) {
      return reply.code(400).send({ success: false, message: "请完整填写注册信息" });
    }
    const passwordError = validateNewPassword(body.data.password);
    if (passwordError) {
      return reply.code(400).send({ success: false, message: passwordError });
    }

    try {
      const passwordHash = await hashPassword(body.data.password);

      const [employee] = await db
        .insert(employees)
        .values({
          name: body.data.name,
          phone: body.data.phone,
          passwordHash,
          role: "employee",
          status: "active",
          enterpriseId: null,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
        })
        .returning({
          id: employees.id,
          name: employees.name,
          dept: employees.dept,
          phone: employees.phone,
          status: employees.status,
          role: employees.role,
          enterpriseId: employees.enterpriseId,
        });

      await writeOpsAudit({
        action: "auth.register_personal",
        targetType: "employee",
        targetId: String(employee.id),
        detail: { name: employee.name, phone: employee.phone },
        ip: req.ip,
      });

      return { success: true, data: employee };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("employees_phone_uidx") || message.includes("unique")) {
        return reply.code(409).send({ success: false, message: "该手机号已提交申请或已注册" });
      }
      throw e;
    }
  });

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

    if (!user || !isSessionRole(user.role)) {
      return reply.code(401).send({ success: false, message: "手机号或密码错误" });
    }

    const ok = await verifyPassword(body.data.password, user.passwordHash);
    if (!ok) {
      return reply.code(401).send({ success: false, message: "手机号或密码错误" });
    }

    if (user.status === "pending") {
      return reply.code(403).send({
        success: false,
        code: "REGISTRATION_PENDING",
        message: "注册申请待审核，请等待管理员审核",
      });
    }

    if (user.status !== "active") {
      return reply.code(401).send({ success: false, message: "手机号或密码错误" });
    }

    if (user.role === "org_admin" || user.role === "team_admin") {
      const enterprise = await loadEnterprise(user.enterpriseId);
      if (!enterprise || enterprise.status !== "active") {
        return reply.code(401).send({ success: false, message: "用户不可用" });
      }
    } else if (user.role === "employee" && user.enterpriseId != null) {
      const enterprise = await loadEnterprise(user.enterpriseId);
      if (!enterprise || enterprise.status === "disabled") {
        return reply.code(401).send({ success: false, message: "用户不可用" });
      }
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
      enterpriseId: user.enterpriseId,
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
        user: publicEmployee(user, await loadEnterprise(user.enterpriseId)),
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
    return { success: true, data: publicEmployee(user, await loadEnterprise(user.enterpriseId)) };
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
        enterpriseId: user.enterpriseId,
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
            ...publicEmployee(user, await loadEnterprise(user.enterpriseId)),
            mustChangePassword: false,
          },
        },
      };
    },
  );
}
