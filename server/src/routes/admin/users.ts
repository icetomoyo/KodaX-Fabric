import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import {
  employeeApiKeys,
  employees,
  quotaPolicy,
  requestAudits,
  usageCountersDaily,
} from "../../db/schema/index.js";
import { hashPassword, validateNewPassword, verifyPassword } from "../../lib/password.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import {
  inclusiveDayCount,
  nextQuotaResetAt,
  quotaDayAt,
  zonedDateRange,
} from "../../lib/quota-time.js";
import {
  appendOtherBucket,
  fillDailyUsage,
  summarizeDailyUsage,
  type UsageBreakdown,
} from "../../lib/user-usage.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().min(5).max(20),
  password: z.string().min(8).max(128),
  dept: z.string().max(100).optional().nullable(),
  role: z.enum(["employee", "admin", "auditor"]).default("employee"),
});

const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    phone: z.string().trim().min(5).max(20).optional(),
    dept: z.string().trim().max(100).nullable().optional(),
    role: z.enum(["employee", "admin", "auditor"]).optional(),
    status: z.enum(["active", "disabled"]).optional(),
  })
  .refine((data) => Object.keys(data).length > 0);

type AdminUserListQuery = {
  limit: number;
  offset: number;
  q?: string;
};

export function buildAdminUserListQuery(query: AdminUserListQuery) {
  return db
    .select({
      id: employees.id,
      name: employees.name,
      phone: employees.phone,
      dept: employees.dept,
      role: employees.role,
      status: employees.status,
      lastLoginAt: employees.lastLoginAt,
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
}

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

    const rows = await buildAdminUserListQuery(query);

    return { success: true, data: rows };
  });

  app.get("/api/admin/users/:id/usage", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    const query = z
      .object({ from: z.string(), to: z.string() })
      .strict()
      .safeParse(req.query);
    if (!params.success || !query.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const dayCount = inclusiveDayCount(query.data.from, query.data.to);
    if (dayCount === null || dayCount < 1 || dayCount > 366) {
      return reply.code(400).send({
        success: false,
        message: dayCount !== null && dayCount > 366 ? "日期范围最多 366 天" : "日期范围无效",
      });
    }

    const [employee] = await db
      .select({
        id: employees.id,
        name: employees.name,
        phone: employees.phone,
        dept: employees.dept,
        role: employees.role,
        status: employees.status,
        lastLoginAt: employees.lastLoginAt,
      })
      .from(employees)
      .where(eq(employees.id, params.data.id))
      .limit(1);
    if (!employee) {
      return reply.code(404).send({ success: false, message: "用户不存在" });
    }

    const { start, endExclusive } = zonedDateRange(
      query.data.from,
      query.data.to,
      env.QUOTA_TIMEZONE,
    );
    const auditWhere = and(
      eq(requestAudits.employeeId, employee.id),
      gte(requestAudits.createdAt, start),
      lt(requestAudits.createdAt, endExclusive),
    );
    const providerKey = sql<string>`coalesce(${requestAudits.providerCode}, 'unknown')`;
    const modelKey = sql<string>`coalesce(${requestAudits.clientModel}, 'unknown')`;

    const [counterRows, providerRows, modelRows, auditTotals, policy] = await Promise.all([
      db
        .select({
          day: usageCountersDaily.day,
          promptTokens: usageCountersDaily.promptTokens,
          completionTokens: usageCountersDaily.completionTokens,
          totalTokens: usageCountersDaily.totalTokens,
          requestCount: usageCountersDaily.requestCount,
          errorCount: usageCountersDaily.errorCount,
        })
        .from(usageCountersDaily)
        .where(and(
          eq(usageCountersDaily.employeeId, employee.id),
          gte(usageCountersDaily.day, query.data.from),
          lte(usageCountersDaily.day, query.data.to),
        ))
        .orderBy(asc(usageCountersDaily.day)),
      db
        .select({
          key: providerKey,
          totalTokens: sql<number>`coalesce(sum(${requestAudits.totalTokens}), 0)`,
          requestCount: sql<number>`count(*)::int`,
        })
        .from(requestAudits)
        .where(auditWhere)
        .groupBy(providerKey)
        .orderBy(desc(sql`coalesce(sum(${requestAudits.totalTokens}), 0)`), asc(providerKey))
        .limit(20),
      db
        .select({
          key: modelKey,
          totalTokens: sql<number>`coalesce(sum(${requestAudits.totalTokens}), 0)`,
          requestCount: sql<number>`count(*)::int`,
        })
        .from(requestAudits)
        .where(auditWhere)
        .groupBy(modelKey)
        .orderBy(desc(sql`coalesce(sum(${requestAudits.totalTokens}), 0)`), asc(modelKey))
        .limit(20),
      db
        .select({
          totalTokens: sql<number>`coalesce(sum(${requestAudits.totalTokens}), 0)`,
          requestCount: sql<number>`count(*)::int`,
          unknownUsageCount: sql<number>`count(*) filter (where ${requestAudits.totalTokens} is null)::int`,
        })
        .from(requestAudits)
        .where(auditWhere),
      db
        .select({ dailyTokenLimit: quotaPolicy.dailyTokenLimit })
        .from(quotaPolicy)
        .where(eq(quotaPolicy.key, "default"))
        .limit(1),
    ]);

    const daily = fillDailyUsage(query.data.from, query.data.to, counterRows);
    const summary = summarizeDailyUsage(daily);
    const totals = {
      totalTokens: Number(auditTotals[0]?.totalTokens) || 0,
      requestCount: Number(auditTotals[0]?.requestCount) || 0,
    };
    const normalizeBreakdown = (
      rows: Array<{ key: string; totalTokens: number; requestCount: number }>,
    ): UsageBreakdown[] => rows.map((row) => ({
      key: row.key,
      totalTokens: Number(row.totalTokens) || 0,
      requestCount: Number(row.requestCount) || 0,
    }));
    const byProvider = appendOtherBucket(normalizeBreakdown(providerRows), totals);
    const byModel = appendOtherBucket(normalizeBreakdown(modelRows), totals);

    const now = new Date();
    const today = quotaDayAt(now, env.QUOTA_TIMEZONE);
    const selectedToday = counterRows.find((row) => row.day === today);
    const [todayRow] = selectedToday
      ? [selectedToday]
      : await db
        .select({ totalTokens: usageCountersDaily.totalTokens })
        .from(usageCountersDaily)
        .where(and(
          eq(usageCountersDaily.employeeId, employee.id),
          eq(usageCountersDaily.day, today),
        ))
        .limit(1);
    const dailyTokenLimit = policy[0]?.dailyTokenLimit;
    if (dailyTokenLimit === null || dailyTokenLimit === undefined) {
      return reply.code(503).send({
        success: false,
        code: "quota_policy_not_initialized",
        message: "默认日 Token 配额未初始化，请先执行数据库迁移",
      });
    }
    const usedToday = Number(todayRow?.totalTokens) || 0;

    return {
      success: true,
      data: {
        employee,
        range: {
          from: query.data.from,
          to: query.data.to,
          timezone: env.QUOTA_TIMEZONE,
        },
        summary,
        daily,
        byProvider,
        byModel,
        unknownUsageCount: Number(auditTotals[0]?.unknownUsageCount) || 0,
        quota: {
          dailyTokenLimit,
          usedToday,
          remainingToday: Math.max(0, dailyTokenLimit - usedToday),
          resetAt: nextQuotaResetAt(now, env.QUOTA_TIMEZONE),
        },
      },
    };
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

  app.patch("/api/admin/users/:id", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    const body = updateUserSchema.safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const values = {
      ...body.data,
      ...(body.data.dept !== undefined ? { dept: body.data.dept || null } : {}),
      updatedAt: new Date(),
    };

    try {
      const result = await db.transaction(async (tx) => {
        const [targetUser] = await tx
          .select({
            id: employees.id,
            role: employees.role,
            status: employees.status,
          })
          .from(employees)
          .where(eq(employees.id, params.data.id))
          .limit(1)
          .for("update");

        if (!targetUser) {
          return { outcome: "not_found" } as const;
        }

        if (
          params.data.id === req.employeeId &&
          ((body.data.status !== undefined && body.data.status !== targetUser.status) ||
            (body.data.role !== undefined && body.data.role !== targetUser.role))
        ) {
          return { outcome: "self_role_or_status" } as const;
        }

        const [row] = await tx
          .update(employees)
          .set(values)
          .where(eq(employees.id, params.data.id))
          .returning({
            id: employees.id,
            name: employees.name,
            phone: employees.phone,
            dept: employees.dept,
            role: employees.role,
            status: employees.status,
            mustChangePassword: employees.mustChangePassword,
            lastLoginAt: employees.lastLoginAt,
          });

        let revokedApiKeyCount = 0;
        if (
          targetUser.role === "employee" &&
          body.data.role !== undefined &&
          body.data.role !== "employee"
        ) {
          const revokedKeys = await tx
            .update(employeeApiKeys)
            .set({ status: "revoked" })
            .where(
              and(
                eq(employeeApiKeys.employeeId, targetUser.id),
                eq(employeeApiKeys.status, "active"),
              ),
            )
            .returning({ id: employeeApiKeys.id });
          revokedApiKeyCount = revokedKeys.length;
        }

        return {
          outcome: "updated",
          row,
          previousRole: targetUser.role,
          revokedApiKeyCount,
        } as const;
      });

      if (result.outcome === "not_found") {
        return reply.code(404).send({ success: false, message: "用户不存在" });
      }
      if (result.outcome === "self_role_or_status") {
        return reply.code(400).send({ success: false, message: "不能修改自己的角色或状态" });
      }

      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "user.update",
        targetType: "employee",
        targetId: String(result.row.id),
        detail: {
          fields: Object.keys(body.data),
          previousRole: result.previousRole,
          role: result.row.role,
          revokedApiKeyCount: result.revokedApiKeyCount,
        },
        ip: req.ip,
      });

      return { success: true, data: result.row };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("employees_phone_uidx") || msg.includes("unique")) {
        return reply.code(409).send({ success: false, message: "手机号已存在" });
      }
      throw e;
    }
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

  app.post("/api/admin/users/:id/reset-password", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    const body = z
      .object({ password: z.string().min(8).max(128) })
      .safeParse(req.body);

    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    if (params.data.id === req.employeeId) {
      return reply.code(400).send({ success: false, message: "请通过修改密码功能更新自己的密码" });
    }

    const policy = validateNewPassword(body.data.password);
    if (policy) {
      return reply.code(400).send({ success: false, message: policy });
    }

    const [targetUser] = await db
      .select({ id: employees.id, passwordHash: employees.passwordHash })
      .from(employees)
      .where(eq(employees.id, params.data.id))
      .limit(1);

    if (!targetUser) {
      return reply.code(404).send({ success: false, message: "用户不存在" });
    }

    if (await verifyPassword(body.data.password, targetUser.passwordHash)) {
      return reply.code(400).send({ success: false, message: "新密码不能与原密码相同" });
    }

    const passwordHash = await hashPassword(body.data.password);
    const [row] = await db
      .update(employees)
      .set({
        passwordHash,
        mustChangePassword: true,
        passwordChangedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(employees.id, params.data.id))
      .returning({
        id: employees.id,
        name: employees.name,
        phone: employees.phone,
        mustChangePassword: employees.mustChangePassword,
      });

    await writeOpsAudit({
      actorEmployeeId: req.employeeId,
      action: "user.reset_password",
      targetType: "employee",
      targetId: String(row.id),
      detail: { phone: row.phone },
      ip: req.ip,
    });

    return { success: true, data: row };
  });
}
