import type { FastifyInstance } from "fastify";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../config.js";
import { DEFAULT_TEAM_NAME } from "../../lib/enterprise.js";
import { db } from "../../db/client.js";
import {
  credentialBindings,
  departments,
  employeeApiKeys,
  employees,
  enterprises,
  requestAudits,
  requestErrorLogs,
  teamMembers,
  teams,
  usageCountersTeamDaily,
} from "../../db/schema/index.js";
import {
  buildTeamUsageByModelQuery,
  buildTeamUsageDailyQuery,
  defaultUsageRange,
  fillDailyTeamUsage,
  mapModelUsageRows,
} from "../../lib/model-cost.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import { inclusiveDayCount, quotaDayAt, zonedDateRange, zonedMonthRange } from "../../lib/quota-time.js";
import {
  canAdminTeam,
  canCreateTeam,
  canReadTeam,
  employeeSingleTeamConflictMessage,
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
  departmentId?: number;
  teamIds?: number[];
};

export function buildTeamListQuery(query: TeamListQuery) {
  const today = quotaDayAt(new Date(), env.QUOTA_TIMEZONE);
  const month = zonedMonthRange(new Date(), env.QUOTA_TIMEZONE);
  const memberCount = sql<number>`(
    select count(*)::int from ${teamMembers} where ${teamMembers.teamId} = ${teams.id}
  )`;
  const todayTotalTokens = sql<number>`(
    select coalesce(sum(${usageCountersTeamDaily.totalTokens}), 0)
    from ${usageCountersTeamDaily}
    where ${usageCountersTeamDaily.teamId} = ${teams.id}
      and ${usageCountersTeamDaily.day} = ${today}
  )`;
  const monthTotalTokens = sql<number>`(
    select coalesce(sum(${usageCountersTeamDaily.totalTokens}), 0)
    from ${usageCountersTeamDaily}
    where ${usageCountersTeamDaily.teamId} = ${teams.id}
      and ${usageCountersTeamDaily.day} >= ${month.from}
      and ${usageCountersTeamDaily.day} <= ${month.to}
  )`;
  return db
    .select({
      id: teams.id,
      name: teams.name,
      status: teams.status,
      enterpriseId: teams.enterpriseId,
      enterpriseName: enterprises.name,
      departmentId: teams.departmentId,
      departmentName: departments.name,
      isDefault: teams.isDefault,
      memberCount,
      todayTotalTokens,
      monthTotalTokens,
      createdAt: teams.createdAt,
      updatedAt: teams.updatedAt,
    })
    .from(teams)
    .innerJoin(enterprises, eq(teams.enterpriseId, enterprises.id))
    .innerJoin(departments, eq(teams.departmentId, departments.id))
    .where(
      and(
        query.enterpriseId != null ? eq(teams.enterpriseId, query.enterpriseId) : sql`true`,
        query.departmentId != null ? eq(teams.departmentId, query.departmentId) : sql`true`,
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

async function loadEmployeeTeamMembership(employeeId: number) {
  const [row] = await db
    .select({
      teamId: teamMembers.teamId,
      teamName: teams.name,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(eq(teamMembers.employeeId, employeeId))
    .limit(1);
  return row ?? null;
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

export async function detachAndDeleteTeam(teamId: number): Promise<void> {
  await db
    .delete(credentialBindings)
    .where(and(eq(credentialBindings.scopeType, "team"), eq(credentialBindings.scopeId, teamId)));
  await db.delete(usageCountersTeamDaily).where(eq(usageCountersTeamDaily.teamId, teamId));
  await db.update(requestAudits).set({ teamId: null }).where(eq(requestAudits.teamId, teamId));
  await db.update(requestErrorLogs).set({ teamId: null }).where(eq(requestErrorLogs.teamId, teamId));
  await db.update(employeeApiKeys).set({ teamId: null }).where(eq(employeeApiKeys.teamId, teamId));
  await db.delete(teams).where(eq(teams.id, teamId));
}

export async function adminTeamRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin", "org_admin", "team_admin"));

  app.get("/api/admin/teams", async (req, reply) => {
    const query = z
      .object({
        enterpriseId: z.coerce.number().int().positive().optional(),
        departmentId: z.coerce.number().int().positive().optional(),
      })
      .parse(req.query);
    const actor = actorFrom(req);
    const adminTeamIds = actor.role === "team_admin" ? await listAdminTeamIds(actor.employeeId) : [];
    const scope = resolveTeamListScope(actor, query.enterpriseId, adminTeamIds);
    if ("forbidden" in scope) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    const rows = await buildTeamListQuery({ ...scope, departmentId: query.departmentId });
    return {
      success: true,
      data: rows.map((row) => ({
        ...row,
        todayTotalTokens: Number(row.todayTotalTokens),
        monthTotalTokens: Number(row.monthTotalTokens),
      })),
    };
  });

  app.post("/api/admin/teams", async (req, reply) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(100),
        departmentId: z.number().int().positive(),
        enterpriseId: z.number().int().positive().optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const actor = actorFrom(req);
    if (actor.role !== "admin" && actor.role !== "org_admin") {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    const [department] = await db
      .select({
        id: departments.id,
        enterpriseId: departments.enterpriseId,
        status: departments.status,
      })
      .from(departments)
      .where(eq(departments.id, body.data.departmentId))
      .limit(1);
    if (!department || department.status !== "active") {
      return reply.code(404).send({ success: false, message: "部门不存在或未启用" });
    }
    const enterpriseId =
      actor.role === "org_admin"
        ? actor.enterpriseId
        : body.data.enterpriseId ?? department.enterpriseId;
    if (
      enterpriseId == null ||
      enterpriseId !== department.enterpriseId ||
      !canCreateTeam(actor, enterpriseId)
    ) {
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
    if (body.data.name === DEFAULT_TEAM_NAME) {
      return reply.code(409).send({ success: false, message: "默认团队由系统创建，请换一个团队名" });
    }
    try {
      const [row] = await db
        .insert(teams)
        .values({
          enterpriseId,
          departmentId: department.id,
          name: body.data.name,
          status: "active",
          isDefault: false,
        })
        .returning({
          id: teams.id,
          name: teams.name,
          status: teams.status,
          enterpriseId: teams.enterpriseId,
          departmentId: teams.departmentId,
          createdAt: teams.createdAt,
        });
      await writeOpsAudit({
        actorEmployeeId: actor.employeeId,
        action: "team.create",
        targetType: "team",
        targetId: String(row.id),
        detail: { name: row.name, enterpriseId, departmentId: department.id },
        ip: req.ip,
      });
      return { success: true, data: row };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("teams_department_name_uidx") || message.includes("unique")) {
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
    const [current] = await db
      .select({ isDefault: teams.isDefault })
      .from(teams)
      .where(eq(teams.id, access.teamId))
      .limit(1);
    if (current?.isDefault) {
      return reply.code(400).send({ success: false, message: "默认团队不能改名或停用" });
    }
    try {
      const [row] = await db
        .update(teams)
        .set({
          ...(body.data.name != null ? { name: body.data.name } : {}),
          ...(body.data.status != null ? { status: body.data.status } : {}),
          updatedAt: new Date(),
        })
        .where(eq(teams.id, access.teamId))
        .returning({
          id: teams.id,
          name: teams.name,
          status: teams.status,
          enterpriseId: teams.enterpriseId,
        });
      await writeOpsAudit({
        actorEmployeeId: actor.employeeId,
        action: "team.update",
        targetType: "team",
        targetId: String(row.id),
        detail: {
          fields: Object.keys(body.data),
          name: row.name,
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

  app.delete("/api/admin/teams/:id", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ success: false, message: "参数无效" });
    const actor = actorFrom(req);
    if (actor.role !== "admin" && actor.role !== "org_admin") {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    const access = await loadTeamAccessForActor(actor, params.data.id);
    if (!access) return reply.code(404).send({ success: false, message: "团队不存在" });
    if (!canCreateTeam(actor, access.enterpriseId)) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    const [current] = await db
      .select({ isDefault: teams.isDefault, name: teams.name })
      .from(teams)
      .where(eq(teams.id, access.teamId))
      .limit(1);
    if (!current) return reply.code(404).send({ success: false, message: "团队不存在" });
    if (current.isDefault) {
      return reply.code(400).send({ success: false, message: "默认团队不能单独删除，没有人时请删除部门" });
    }
    const [members] = await db
      .select({ n: count() })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, access.teamId));
    if (Number(members?.n ?? 0) > 0) {
      return reply.code(409).send({ success: false, message: "团队下已绑定员工，无法删除" });
    }
    await detachAndDeleteTeam(access.teamId);
    await writeOpsAudit({
      actorEmployeeId: actor.employeeId,
      action: "team.delete",
      targetType: "team",
      targetId: String(access.teamId),
      detail: { name: current.name },
      ip: req.ip,
    });
    return { success: true };
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
    const month = zonedMonthRange(new Date(), env.QUOTA_TIMEZONE);
    const monthTotalTokens = sql<number>`(
      select coalesce(sum(uc.total_tokens), 0)
      from usage_counters_team_daily uc
      where uc.team_id = ${teamMembers.teamId}
        and uc.employee_id = ${teamMembers.employeeId}
        and uc.day >= ${month.from}
        and uc.day <= ${month.to}
    )`;
    const rows = await db
      .select({
        id: teamMembers.id,
        employeeId: employees.id,
        name: employees.name,
        phone: employees.phone,
        dept: employees.dept,
        role: teamMembers.role,
        status: employees.status,
        todayTotalTokens: sql<number>`coalesce(${usageCountersTeamDaily.totalTokens}, 0)`,
        monthTotalTokens,
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
        monthTotalTokens: Number(row.monthTotalTokens),
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
        employeeId: z.number().int().positive().optional(),
        phone: z.string().trim().min(5).max(20).optional(),
        role: z.enum(["member", "team_admin"]).default("member"),
      })
      .refine((data) => data.employeeId != null || Boolean(data.phone))
      .safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "请填写已注册用户的手机号" });
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
      .where(
        body.data.employeeId != null
          ? eq(employees.id, body.data.employeeId)
          : eq(employees.phone, body.data.phone!),
      )
      .limit(1);
    if (!target || target.status !== "active") {
      return reply.code(404).send({ success: false, message: "未找到已注册用户" });
    }
    if (target.role === "admin" || target.role === "org_admin") {
      return reply.code(400).send({ success: false, message: "不能将该角色加入团队" });
    }
    if (target.enterpriseId != null && target.enterpriseId !== access.enterpriseId) {
      return reply.code(409).send({ success: false, message: "该用户已加入其他企业" });
    }
    if (target.enterpriseId == null) {
      await db
        .update(employees)
        .set({ enterpriseId: access.enterpriseId, updatedAt: new Date() })
        .where(eq(employees.id, target.id));
    }
    const existingMembership = await loadEmployeeTeamMembership(target.id);
    const conflict = employeeSingleTeamConflictMessage(existingMembership, access.teamId);
    if (conflict) {
      return reply.code(409).send({ success: false, message: conflict });
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
      if (
        message.includes("team_members_team_employee_uidx") ||
        message.includes("team_members_employee_uidx") ||
        message.includes("unique")
      ) {
        const raced = await loadEmployeeTeamMembership(target.id);
        return reply.code(409).send({
          success: false,
          message: employeeSingleTeamConflictMessage(raced, access.teamId) ?? "该员工已在团队中",
        });
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
        role: z.enum(["member", "team_admin"]),
      })
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
    const [row] = await db
      .update(teamMembers)
      .set({ role: body.data.role })
      .where(
        and(
          eq(teamMembers.teamId, access.teamId),
          eq(teamMembers.employeeId, params.data.employeeId),
        ),
      )
      .returning({
        employeeId: teamMembers.employeeId,
        role: teamMembers.role,
      });
    if (!row) return reply.code(404).send({ success: false, message: "成员不存在" });
    await refreshConsoleRole(row.employeeId);
    await writeOpsAudit({
      actorEmployeeId: actor.employeeId,
      action: "team.member_role",
      targetType: "team",
      targetId: String(access.teamId),
      detail: { employeeId: row.employeeId, role: row.role },
      ip: req.ip,
    });
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
