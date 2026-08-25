import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, gte, lt, lte, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import {
  employeeApiKeys,
  employees,
  requestAudits,
  usageCountersDaily,
} from "../../db/schema/index.js";
import { listEmployeeTeamQuotaViews } from "../../lib/team-quota.js";
import {
  canAccessEmployee,
  resolveUpdatedUserFields,
  resolveUserListScope,
} from "../../lib/enterprise.js";
import type { SessionRole } from "../../lib/jwt.js";
import {
  hashPassword,
  REGISTRATION_INITIAL_PASSWORD,
  validateNewPassword,
  verifyPassword,
} from "../../lib/password.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import {
  inclusiveDayCount,
  nextQuotaResetAt,
  quotaDayAt,
  zonedDateRange,
  zonedMonthRange,
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

const updateRoleSchema = z.enum(["employee", "admin", "org_admin", "team_admin"]);

const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    phone: z.string().trim().min(5).max(20).optional(),
    dept: z.string().trim().max(100).nullable().optional(),
    role: updateRoleSchema.optional(),
    status: z.enum(["active", "disabled"]).optional(),
    enterpriseId: z.number().int().positive().optional().nullable(),
  })
  .refine((data) => Object.keys(data).length > 0);

type AdminUserListQuery = {
  limit: number;
  offset: number;
  q?: string;
  status?: "pending" | "active" | "disabled";
  enterpriseId?: number;
  excludeRoles?: SessionRole[];
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
      enterpriseId: employees.enterpriseId,
      lastLoginAt: employees.lastLoginAt,
      createdAt: employees.createdAt,
    })
    .from(employees)
    .where(
      and(
        query.q
          ? sql`(${employees.name} ilike ${"%" + query.q + "%"} or ${employees.phone} ilike ${"%" + query.q + "%"})`
          : sql`true`,
        query.status ? eq(employees.status, query.status) : sql`true`,
        query.enterpriseId != null ? eq(employees.enterpriseId, query.enterpriseId) : sql`true`,
        query.excludeRoles?.length ? notInArray(employees.role, query.excludeRoles) : sql`true`,
      ),
    )
    .orderBy(desc(employees.id))
    .limit(query.limit)
    .offset(query.offset);
}

function actorFrom(req: { session?: { role: SessionRole; enterpriseId: number | null } }) {
  return { role: req.session!.role, enterpriseId: req.session!.enterpriseId ?? null };
}

export async function adminUserRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("org_admin"));

  app.get("/api/admin/users", async (req, reply) => {
    const query = z
      .object({
        limit: z.coerce.number().min(1).max(200).default(50),
        offset: z.coerce.number().min(0).default(0),
        q: z.string().optional(),
        status: z.enum(["pending", "active", "disabled"]).optional(),
        enterpriseId: z.coerce.number().int().positive().optional(),
      })
      .parse(req.query);

    const scope = resolveUserListScope(
      { role: req.session!.role, enterpriseId: req.session!.enterpriseId },
      query.enterpriseId,
    );
    if ("forbidden" in scope) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }

    const rows = await buildAdminUserListQuery({
      limit: query.limit,
      offset: query.offset,
      q: query.q,
      status: query.status,
      enterpriseId: scope.enterpriseId,
      excludeRoles: scope.excludeRoles,
    });

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
        enterpriseId: employees.enterpriseId,
        lastLoginAt: employees.lastLoginAt,
      })
      .from(employees)
      .where(eq(employees.id, params.data.id))
      .limit(1);
    if (!employee) {
      return reply.code(404).send({ success: false, message: "用户不存在" });
    }
    if (!canAccessEmployee(actorFrom(req), employee)) {
      return reply.code(403).send({ success: false, message: "权限不足" });
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

    const [counterRows, providerRows, modelRows, auditTotals] = await Promise.all([
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
    const usedToday = Number(todayRow?.totalTokens) || 0;
    const teamQuotas = await listEmployeeTeamQuotaViews(
      employee.id,
      today,
      zonedMonthRange(now, env.QUOTA_TIMEZONE),
    );

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
          usedToday,
          resetAt: nextQuotaResetAt(now, env.QUOTA_TIMEZONE),
          teams: teamQuotas,
        },
      },
    };
  });

  app.post("/api/admin/users/:id/approve", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const result = await db.transaction(async (tx) => {
      const [application] = await tx
        .select({
          id: employees.id,
          name: employees.name,
          phone: employees.phone,
          dept: employees.dept,
          status: employees.status,
          role: employees.role,
          enterpriseId: employees.enterpriseId,
        })
        .from(employees)
        .where(eq(employees.id, params.data.id))
        .limit(1)
        .for("update");

      if (!application) return { outcome: "not_found" } as const;
      if (!canAccessEmployee(actorFrom(req), application)) return { outcome: "forbidden" } as const;
      if (application.status !== "pending") return { outcome: "already_processed" } as const;

      const passwordHash = await hashPassword(REGISTRATION_INITIAL_PASSWORD);
      const [employee] = await tx
        .update(employees)
        .set({
          status: "active",
          role: "employee",
          passwordHash,
          mustChangePassword: true,
          passwordChangedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(employees.id, application.id))
        .returning({
          id: employees.id,
          name: employees.name,
          dept: employees.dept,
          phone: employees.phone,
          status: employees.status,
          mustChangePassword: employees.mustChangePassword,
        });

      return { outcome: "approved", employee } as const;
    });

    if (result.outcome === "not_found") {
      return reply.code(404).send({ success: false, message: "注册申请不存在" });
    }
    if (result.outcome === "forbidden") {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    if (result.outcome === "already_processed") {
      return reply.code(409).send({ success: false, message: "该注册申请已审核" });
    }

    await writeOpsAudit({
      actorEmployeeId: req.employeeId,
      action: "user.registration_approve",
      targetType: "employee",
      targetId: String(result.employee.id),
      detail: {
        name: result.employee.name,
        dept: result.employee.dept,
        phone: result.employee.phone,
      },
      ip: req.ip,
    });

    return { success: true, data: result.employee };
  });

  app.post("/api/admin/users", async (_req, reply) => {
    return reply.code(403).send({
      success: false,
      message: "新账号只能由用户自行注册",
    });
  });

  app.post("/api/admin/users/import", async (_req, reply) => {
    return reply.code(403).send({
      success: false,
      message: "新账号只能由用户自行注册",
    });
  });

  app.patch("/api/admin/users/:id", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    const body = updateUserSchema.safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    try {
      const result = await db.transaction(async (tx) => {
        const [targetUser] = await tx
          .select({
            id: employees.id,
            role: employees.role,
            status: employees.status,
            enterpriseId: employees.enterpriseId,
          })
          .from(employees)
          .where(eq(employees.id, params.data.id))
          .limit(1)
          .for("update");

        if (!targetUser) {
          return { outcome: "not_found" } as const;
        }

        const membership = resolveUpdatedUserFields(actorFrom(req), targetUser, {
          role: body.data.role,
          enterpriseId: body.data.enterpriseId,
        });
        if ("error" in membership) {
          return { outcome: "forbidden" } as const;
        }

        if (
          targetUser.status === "pending" &&
          (body.data.status !== undefined || body.data.role !== undefined)
        ) {
          return { outcome: "pending_review" } as const;
        }

        if (
          params.data.id === req.employeeId &&
          ((body.data.status !== undefined && body.data.status !== targetUser.status) ||
            (body.data.role !== undefined && body.data.role !== targetUser.role))
        ) {
          return { outcome: "self_role_or_status" } as const;
        }

        const values = {
          ...body.data,
          ...(body.data.dept !== undefined ? { dept: body.data.dept || null } : {}),
          role: membership.role,
          enterpriseId: membership.enterpriseId,
          updatedAt: new Date(),
        };

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
            enterpriseId: employees.enterpriseId,
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
      if (result.outcome === "forbidden") {
        return reply.code(403).send({ success: false, message: "权限不足" });
      }
      if (result.outcome === "pending_review") {
        return reply.code(400).send({
          success: false,
          message: "待审核注册申请请使用“审核通过”操作",
        });
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

    const [targetUser] = await db
      .select({
        id: employees.id,
        status: employees.status,
        role: employees.role,
        enterpriseId: employees.enterpriseId,
      })
      .from(employees)
      .where(eq(employees.id, params.data.id))
      .limit(1);

    if (!targetUser) {
      return reply.code(404).send({ success: false, message: "用户不存在" });
    }
    if (!canAccessEmployee(actorFrom(req), targetUser)) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    if (targetUser.status === "pending") {
      return reply.code(400).send({
        success: false,
        message: "待审核注册申请请使用“审核通过”操作",
      });
    }

    const [row] = await db
      .update(employees)
      .set({ status: body.data.status, updatedAt: new Date() })
      .where(eq(employees.id, params.data.id))
      .returning({ id: employees.id, status: employees.status });

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
      .select({
        id: employees.id,
        passwordHash: employees.passwordHash,
        role: employees.role,
        enterpriseId: employees.enterpriseId,
      })
      .from(employees)
      .where(eq(employees.id, params.data.id))
      .limit(1);

    if (!targetUser) {
      return reply.code(404).send({ success: false, message: "用户不存在" });
    }
    if (!canAccessEmployee(actorFrom(req), targetUser)) {
      return reply.code(403).send({ success: false, message: "权限不足" });
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
