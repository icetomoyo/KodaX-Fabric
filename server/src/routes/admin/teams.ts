import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import {
  credentialBindings,
  departments,
  employeeApiKeys,
  employees,
  enterprises,
  requestAudits,
  requestErrorLogs,
  sensitiveWordHits,
  teamMembers,
  teams,
  usageCountersTeamDaily,
} from "../../db/schema/index.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import { quotaDayAt, zonedMonthRange } from "../../lib/quota-time.js";
import {
  canAdminTeam,
  canReadTeam,
  employeeDepartmentConflictMessage,
  loadOrgActor,
  loadTeamAccessForActor,
  resolveTeamListScope,
  type OrgActor,
} from "../../lib/org.js";
import type { SessionRole } from "../../lib/jwt.js";
import {
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

type TeamListQuery = {
  enterpriseId?: number;
  departmentId?: number;
  departmentIds?: number[];
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
        query.departmentIds?.length ? inArray(teams.departmentId, query.departmentIds) : sql`true`,
        query.teamIds?.length ? inArray(teams.id, query.teamIds) : sql`true`,
      ),
    )
    .orderBy(desc(teams.id));
}

async function actorFrom(req: {
  session?: {
    role: SessionRole;
    enterpriseId: number | null;
    departmentIds?: number[];
    teamIds?: number[];
  };
  employeeId?: number;
}): Promise<OrgActor> {
  return loadOrgActor({
    role: req.session!.role,
    enterpriseId: req.session!.enterpriseId ?? null,
    employeeId: req.employeeId!,
    departmentIds: req.session!.departmentIds,
  });
}

async function loadEmployeeDepartmentMemberships(employeeId: number) {
  return db
    .select({
      teamId: teamMembers.teamId,
      departmentId: teams.departmentId,
      departmentName: departments.name,
      isDefault: teams.isDefault,
      status: teams.status,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .innerJoin(departments, eq(teams.departmentId, departments.id))
    .where(eq(teamMembers.employeeId, employeeId));
}

export async function detachAndDeleteTeam(teamId: number): Promise<void> {
  await db
    .delete(credentialBindings)
    .where(and(eq(credentialBindings.scopeType, "team"), eq(credentialBindings.scopeId, teamId)));
  await db.delete(usageCountersTeamDaily).where(eq(usageCountersTeamDaily.teamId, teamId));
  await db.update(requestAudits).set({ teamId: null }).where(eq(requestAudits.teamId, teamId));
  await db.update(requestErrorLogs).set({ teamId: null }).where(eq(requestErrorLogs.teamId, teamId));
  await db.update(sensitiveWordHits).set({ teamId: null }).where(eq(sensitiveWordHits.teamId, teamId));
  await db.update(employeeApiKeys).set({ teamId: null }).where(eq(employeeApiKeys.teamId, teamId));
  await db.delete(teams).where(eq(teams.id, teamId));
}

export async function adminTeamRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requireRoles("admin", "org_admin", "dept_admin"));

  app.get("/api/admin/teams", async (req, reply) => {
    const parsed = z
      .object({
        enterpriseId: z.coerce.number().int().positive().optional(),
        departmentId: z.coerce.number().int().positive().optional(),
      })
      .safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const query = parsed.data;
    const actor = await actorFrom(req);
    const scope = resolveTeamListScope(actor, query.enterpriseId, []);
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

  app.get("/api/admin/teams/:id/members", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ success: false, message: "参数无效" });
    const actor = await actorFrom(req);
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

  app.post("/api/admin/teams/:id/members", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    const body = z
      .object({
        employeeId: z.number().int().positive().optional(),
        phone: z.string().trim().min(5).max(20).optional(),
      })
      .refine((data) => data.employeeId != null || Boolean(data.phone))
      .safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "请填写已注册用户的手机号" });
    }
    const actor = await actorFrom(req);
    const access = await loadTeamAccessForActor(actor, params.data.id);
    if (!access) return reply.code(404).send({ success: false, message: "团队不存在" });
    if (!canAdminTeam(actor, access)) {
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
    const existingMemberships = await loadEmployeeDepartmentMemberships(target.id);
    const conflict = employeeDepartmentConflictMessage(existingMemberships, {
      teamId: access.teamId,
      departmentId: access.departmentId,
    });
    if (conflict) {
      return reply.code(409).send({ success: false, message: conflict });
    }
    try {
      const [row] = await db
        .insert(teamMembers)
        .values({
          teamId: access.teamId,
          employeeId: target.id,
        })
        .returning({
          id: teamMembers.id,
          employeeId: teamMembers.employeeId,
        });
      await writeOpsAudit({
        actorEmployeeId: actor.employeeId,
        action: "team.member_add",
        targetType: "team",
        targetId: String(access.teamId),
        detail: { employeeId: target.id },
        ip: req.ip,
      });
      return { success: true, data: row };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("team_members_team_employee_uidx") || message.includes("unique")) {
        const raced = await loadEmployeeDepartmentMemberships(target.id);
        return reply.code(409).send({
          success: false,
          message:
            employeeDepartmentConflictMessage(raced, {
              teamId: access.teamId,
              departmentId: access.departmentId,
            }) ?? "该员工已在该部门中",
        });
      }
      throw error;
    }
  });

  app.delete("/api/admin/teams/:id/members/:employeeId", async (req, reply) => {
    const params = z
      .object({
        id: z.coerce.number().int().positive(),
        employeeId: z.coerce.number().int().positive(),
      })
      .safeParse(req.params);
    if (!params.success) return reply.code(400).send({ success: false, message: "参数无效" });
    const actor = await actorFrom(req);
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
