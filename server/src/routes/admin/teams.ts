import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import {
  employees,
  enterprises,
  teamMembers,
  teams,
  usageCountersTeamDaily,
} from "../../db/schema/index.js";
import {
  buildTeamUsageByModelQuery,
  buildTeamUsageDailyQuery,
  defaultUsageRange,
  fillDailyTeamUsage,
  formatYuan,
  mapModelUsageRows,
  memberTodayCostYuanSql,
  teamTodayCostYuanSql,
} from "../../lib/model-cost.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import { inclusiveDayCount, quotaDayAt, zonedDateRange } from "../../lib/quota-time.js";
import {
  canAdminTeam,
  canCreateTeam,
  canReadTeam,
  listAdminTeamIds,
  loadTeamAccessForActor,
  resolveTeamListScope,
  type OrgActor,
} from "../../lib/org.js";
import type { SessionRole } from "../../lib/jwt.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

type TeamListQuery = {
  enterpriseId?: number;
  teamIds?: number[];
};

export function buildTeamListQuery(query: TeamListQuery) {
  const today = quotaDayAt(new Date(), env.QUOTA_TIMEZONE);
  const { start, endExclusive } = zonedDateRange(today, today, env.QUOTA_TIMEZONE);
  const memberCount = sql<number>`(
    select count(*)::int from ${teamMembers} where ${teamMembers.teamId} = ${teams.id}
  )`;
  const todayTotalTokens = sql<number>`(
    select coalesce(sum(${usageCountersTeamDaily.totalTokens}), 0)
    from ${usageCountersTeamDaily}
    where ${usageCountersTeamDaily.teamId} = ${teams.id}
      and ${usageCountersTeamDaily.day} = ${today}
  )`;
  const todayCostYuan = teamTodayCostYuanSql(start, endExclusive);
  return db
    .select({
      id: teams.id,
      name: teams.name,
      status: teams.status,
      enterpriseId: teams.enterpriseId,
      enterpriseName: enterprises.name,
      memberCount,
      dailyTokenQuota: teams.dailyTokenQuota,
      todayTotalTokens,
      todayCostYuan,
      createdAt: teams.createdAt,
      updatedAt: teams.updatedAt,
    })
    .from(teams)
    .innerJoin(enterprises, eq(teams.enterpriseId, enterprises.id))
    .where(
      and(
        query.enterpriseId != null ? eq(teams.enterpriseId, query.enterpriseId) : sql`true`,
        query.teamIds?.length ? inArray(teams.id, query.teamIds) : sql`true`,
      ),
    )
    .orderBy(desc(teams.id));
}

function actorFrom(req: {
  session?: { role: SessionRole; enterpriseId: number | null };
  employeeId?: number;
}): OrgActor {
  return {
    role: req.session!.role,
    enterpriseId: req.session!.enterpriseId ?? null,
    employeeId: req.employeeId!,
  };
}

async function refreshConsoleRole(employeeId: number) {
  const [employee] = await db
    .select({ id: employees.id, role: employees.role })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);
  if (!employee || employee.role === "admin" || employee.role === "org_admin") return;
  const adminIds = await listAdminTeamIds(employeeId);
  const nextRole: SessionRole = adminIds.length ? "team_admin" : "employee";
  if (employee.role !== nextRole) {
    await db
      .update(employees)
      .set({ role: nextRole, updatedAt: new Date() })
      .where(eq(employees.id, employeeId));
  }
}

export async function adminTeamRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin", "org_admin", "team_admin"));

  app.get("/api/admin/teams", async (req, reply) => {
    const query = z
      .object({
        enterpriseId: z.coerce.number().int().positive().optional(),
      })
      .parse(req.query);
    const actor = actorFrom(req);
    const adminTeamIds = actor.role === "team_admin" ? await listAdminTeamIds(actor.employeeId) : [];
    const scope = resolveTeamListScope(actor, query.enterpriseId, adminTeamIds);
    if ("forbidden" in scope) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    const rows = await buildTeamListQuery(scope);
    return {
      success: true,
      data: rows.map((row) => ({
        ...row,
        dailyTokenQuota: Number(row.dailyTokenQuota),
        todayTotalTokens: Number(row.todayTotalTokens),
        todayCostYuan: formatYuan(row.todayCostYuan),
      })),
    };
  });

  app.post("/api/admin/teams", async (req, reply) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(100),
        enterpriseId: z.number().int().positive().optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const actor = actorFrom(req);
    const enterpriseId = body.data.enterpriseId ?? actor.enterpriseId;
    if (enterpriseId == null || !canCreateTeam(actor, enterpriseId)) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    const [enterprise] = await db
      .select({ id: enterprises.id, status: enterprises.status })
      .from(enterprises)
      .where(eq(enterprises.id, enterpriseId))
      .limit(1);
    if (!enterprise || enterprise.status !== "active") {
      return reply.code(404).send({ success: false, message: "企业不存在或未启用" });
    }
    try {
      const [row] = await db
        .insert(teams)
        .values({ enterpriseId, name: body.data.name, status: "active" })
        .returning({
          id: teams.id,
          name: teams.name,
          status: teams.status,
          enterpriseId: teams.enterpriseId,
          createdAt: teams.createdAt,
        });
      await writeOpsAudit({
        actorEmployeeId: actor.employeeId,
        action: "team.create",
        targetType: "team",
        targetId: String(row.id),
        detail: { name: row.name, enterpriseId },
        ip: req.ip,
      });
      return { success: true, data: row };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("teams_enterprise_name_uidx") || message.includes("unique")) {
        return reply.code(409).send({ success: false, message: "团队名称已存在" });
      }
      throw error;
    }
  });

  app.patch("/api/admin/teams/:id", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    const body = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        status: z.enum(["active", "disabled"]).optional(),
        dailyTokenQuota: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
      })
      .refine((data) => Object.keys(data).length > 0)
      .safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const actor = actorFrom(req);
    const access = await loadTeamAccessForActor(actor, params.data.id);
    if (!access) return reply.code(404).send({ success: false, message: "团队不存在" });
    if (!canCreateTeam(actor, access.enterpriseId)) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    try {
      const [row] = await db
        .update(teams)
        .set({ ...body.data, updatedAt: new Date() })
        .where(eq(teams.id, access.teamId))
        .returning({
          id: teams.id,
          name: teams.name,
          status: teams.status,
          enterpriseId: teams.enterpriseId,
          dailyTokenQuota: teams.dailyTokenQuota,
        });
      await writeOpsAudit({
        actorEmployeeId: actor.employeeId,
        action: "team.update",
        targetType: "team",
        targetId: String(row.id),
        detail: {
          fields: Object.keys(body.data),
          name: row.name,
          dailyTokenQuota: row.dailyTokenQuota,
        },
        ip: req.ip,
      });
      return { success: true, data: row };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("teams_enterprise_name_uidx") || message.includes("unique")) {
        return reply.code(409).send({ success: false, message: "团队名称已存在" });
      }
      throw error;
    }
  });

  app.get("/api/admin/teams/:id/members", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ success: false, message: "参数无效" });
    const actor = actorFrom(req);
    const access = await loadTeamAccessForActor(actor, params.data.id);
    if (!access) return reply.code(404).send({ success: false, message: "团队不存在" });
    if (!canReadTeam(actor, access)) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    const today = quotaDayAt(new Date(), env.QUOTA_TIMEZONE);
    const { start, endExclusive } = zonedDateRange(today, today, env.QUOTA_TIMEZONE);
    const rows = await db
      .select({
        id: teamMembers.id,
        employeeId: employees.id,
        name: employees.name,
        phone: employees.phone,
        dept: employees.dept,
        role: teamMembers.role,
        status: employees.status,
        dailyTokenLimit: teamMembers.dailyTokenLimit,
        todayTotalTokens: sql<number>`coalesce(${usageCountersTeamDaily.totalTokens}, 0)`,
        todayCostYuan: memberTodayCostYuanSql(access.teamId, start, endExclusive),
        createdAt: teamMembers.createdAt,
      })
      .from(teamMembers)
      .innerJoin(employees, eq(teamMembers.employeeId, employees.id))
      .leftJoin(
        usageCountersTeamDaily,
        and(
          eq(usageCountersTeamDaily.teamId, teamMembers.teamId),
          eq(usageCountersTeamDaily.employeeId, teamMembers.employeeId),
          eq(usageCountersTeamDaily.day, today),
        ),
      )
      .where(eq(teamMembers.teamId, access.teamId))
      .orderBy(desc(teamMembers.id));
    return {
      success: true,
      data: rows.map((row) => ({
        ...row,
        todayTotalTokens: Number(row.todayTotalTokens),
        todayCostYuan: formatYuan(row.todayCostYuan),
      })),
    };
  });

  app.get("/api/admin/teams/:id/usage", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    const defaults = defaultUsageRange(new Date(), env.QUOTA_TIMEZONE);
    const query = z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .safeParse(req.query);
    if (!params.success || !query.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const from = query.data.from ?? defaults.from;
    const to = query.data.to ?? defaults.to;
    const dayCount = inclusiveDayCount(from, to);
    if (dayCount === null || dayCount < 1 || dayCount > 366) {
      return reply.code(400).send({
        success: false,
        message: dayCount !== null && dayCount > 366 ? "日期范围最多 366 天" : "日期范围无效",
      });
    }
    const actor = actorFrom(req);
    const access = await loadTeamAccessForActor(actor, params.data.id);
    if (!access) return reply.code(404).send({ success: false, message: "团队不存在" });
    if (!canAdminTeam(actor, access)) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    const { start, endExclusive } = zonedDateRange(from, to, env.QUOTA_TIMEZONE);
    const [dailyRows, modelRows] = await Promise.all([
      buildTeamUsageDailyQuery({
        teamId: access.teamId,
        start,
        endExclusive,
        timeZone: env.QUOTA_TIMEZONE,
      }),
      buildTeamUsageByModelQuery({
        teamId: access.teamId,
        start,
        endExclusive,
      }),
    ]);
    return {
      success: true,
      data: {
        from,
        to,
        daily: fillDailyTeamUsage(from, to, dailyRows),
        byModel: mapModelUsageRows(modelRows),
      },
    };
  });

  app.post("/api/admin/teams/:id/members", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    const body = z
      .object({
        employeeId: z.number().int().positive(),
        role: z.enum(["member", "team_admin"]).default("member"),
      })
      .safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const actor = actorFrom(req);
    const access = await loadTeamAccessForActor(actor, params.data.id);
    if (!access) return reply.code(404).send({ success: false, message: "团队不存在" });
    if (body.data.role === "team_admin" && !canCreateTeam(actor, access.enterpriseId)) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    if (body.data.role === "member" && !canAdminTeam(actor, access)) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    const [target] = await db
      .select({
        id: employees.id,
        enterpriseId: employees.enterpriseId,
        status: employees.status,
        role: employees.role,
      })
      .from(employees)
      .where(eq(employees.id, body.data.employeeId))
      .limit(1);
    if (!target || target.status !== "active" || target.enterpriseId !== access.enterpriseId) {
      return reply.code(404).send({ success: false, message: "员工不存在或不属于本企业" });
    }
    if (target.role === "admin") {
      return reply.code(400).send({ success: false, message: "不能将超级管理员加入团队" });
    }
    try {
      const [row] = await db
        .insert(teamMembers)
        .values({
          teamId: access.teamId,
          employeeId: target.id,
          role: body.data.role,
        })
        .returning({
          id: teamMembers.id,
          employeeId: teamMembers.employeeId,
          role: teamMembers.role,
        });
      await refreshConsoleRole(target.id);
      await writeOpsAudit({
        actorEmployeeId: actor.employeeId,
        action: "team.member_add",
        targetType: "team",
        targetId: String(access.teamId),
        detail: { employeeId: target.id, role: row.role },
        ip: req.ip,
      });
      return { success: true, data: row };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("team_members_team_employee_uidx") || message.includes("unique")) {
        return reply.code(409).send({ success: false, message: "该员工已在团队中" });
      }
      throw error;
    }
  });

  app.patch("/api/admin/teams/:id/members/:employeeId", async (req, reply) => {
    const params = z
      .object({
        id: z.coerce.number().int().positive(),
        employeeId: z.coerce.number().int().positive(),
      })
      .safeParse(req.params);
    const body = z
      .object({
        role: z.enum(["member", "team_admin"]).optional(),
        dailyTokenLimit: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
      })
      .refine((data) => data.role !== undefined || data.dailyTokenLimit !== undefined)
      .safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const actor = actorFrom(req);
    const access = await loadTeamAccessForActor(actor, params.data.id);
    if (!access) return reply.code(404).send({ success: false, message: "团队不存在" });
    if (body.data.role !== undefined && !canCreateTeam(actor, access.enterpriseId)) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    if (!canAdminTeam(actor, access)) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    const patch: {
      role?: "member" | "team_admin";
      dailyTokenLimit?: number | null;
    } = {};
    if (body.data.role !== undefined) patch.role = body.data.role;
    if (body.data.dailyTokenLimit !== undefined) patch.dailyTokenLimit = body.data.dailyTokenLimit;
    const [row] = await db
      .update(teamMembers)
      .set(patch)
      .where(
        and(
          eq(teamMembers.teamId, access.teamId),
          eq(teamMembers.employeeId, params.data.employeeId),
        ),
      )
      .returning({
        employeeId: teamMembers.employeeId,
        role: teamMembers.role,
        dailyTokenLimit: teamMembers.dailyTokenLimit,
      });
    if (!row) return reply.code(404).send({ success: false, message: "成员不存在" });
    if (body.data.role !== undefined) {
      await refreshConsoleRole(row.employeeId);
      await writeOpsAudit({
        actorEmployeeId: actor.employeeId,
        action: "team.member_role",
        targetType: "team",
        targetId: String(access.teamId),
        detail: { employeeId: row.employeeId, role: row.role },
        ip: req.ip,
      });
    }
    if (body.data.dailyTokenLimit !== undefined) {
      await writeOpsAudit({
        actorEmployeeId: actor.employeeId,
        action: "team.member_limit",
        targetType: "team",
        targetId: String(access.teamId),
        detail: { employeeId: row.employeeId, dailyTokenLimit: row.dailyTokenLimit },
        ip: req.ip,
      });
    }
    return { success: true, data: row };
  });

  app.delete("/api/admin/teams/:id/members/:employeeId", async (req, reply) => {
    const params = z
      .object({
        id: z.coerce.number().int().positive(),
        employeeId: z.coerce.number().int().positive(),
      })
      .safeParse(req.params);
    if (!params.success) return reply.code(400).send({ success: false, message: "参数无效" });
    const actor = actorFrom(req);
    const access = await loadTeamAccessForActor(actor, params.data.id);
    if (!access) return reply.code(404).send({ success: false, message: "团队不存在" });
    if (!canAdminTeam(actor, access)) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    const deleted = await db
      .delete(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, access.teamId),
          eq(teamMembers.employeeId, params.data.employeeId),
        ),
      )
      .returning({ employeeId: teamMembers.employeeId });
    if (!deleted.length) return reply.code(404).send({ success: false, message: "成员不存在" });
    await refreshConsoleRole(params.data.employeeId);
    await writeOpsAudit({
      actorEmployeeId: actor.employeeId,
      action: "team.member_remove",
      targetType: "team",
      targetId: String(access.teamId),
      detail: { employeeId: params.data.employeeId },
      ip: req.ip,
    });
    return { success: true };
  });
}
