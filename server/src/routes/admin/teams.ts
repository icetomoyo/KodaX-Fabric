import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  employees,
  enterprises,
  projectMembers,
  projects,
  teamMembers,
  teams,
} from "../../db/schema/index.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
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
  const memberCount = sql<number>`(
    select count(*)::int from ${teamMembers} where ${teamMembers.teamId} = ${teams.id}
  )`;
  const projectCount = sql<number>`(
    select count(*)::int from ${projects} where ${projects.teamId} = ${teams.id}
  )`;
  return db
    .select({
      id: teams.id,
      name: teams.name,
      status: teams.status,
      enterpriseId: teams.enterpriseId,
      enterpriseName: enterprises.name,
      memberCount,
      projectCount,
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
    return { success: true, data: rows };
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
        });
      await writeOpsAudit({
        actorEmployeeId: actor.employeeId,
        action: "team.update",
        targetType: "team",
        targetId: String(row.id),
        detail: { fields: Object.keys(body.data), name: row.name },
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
    const rows = await db
      .select({
        id: teamMembers.id,
        employeeId: employees.id,
        name: employees.name,
        phone: employees.phone,
        dept: employees.dept,
        role: teamMembers.role,
        status: employees.status,
        createdAt: teamMembers.createdAt,
      })
      .from(teamMembers)
      .innerJoin(employees, eq(teamMembers.employeeId, employees.id))
      .where(eq(teamMembers.teamId, access.teamId))
      .orderBy(desc(teamMembers.id));
    return { success: true, data: rows };
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
    const body = z.object({ role: z.enum(["member", "team_admin"]) }).safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const actor = actorFrom(req);
    const access = await loadTeamAccessForActor(actor, params.data.id);
    if (!access) return reply.code(404).send({ success: false, message: "团队不存在" });
    if (!canCreateTeam(actor, access.enterpriseId)) {
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
      .returning({ employeeId: teamMembers.employeeId, role: teamMembers.role });
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
    const projectIds = (
      await db.select({ id: projects.id }).from(projects).where(eq(projects.teamId, access.teamId))
    ).map((row) => row.id);
    if (projectIds.length) {
      await db
        .delete(projectMembers)
        .where(
          and(
            inArray(projectMembers.projectId, projectIds),
            eq(projectMembers.employeeId, params.data.employeeId),
          ),
        );
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

  app.get("/api/admin/teams/:id/projects", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ success: false, message: "参数无效" });
    const actor = actorFrom(req);
    const access = await loadTeamAccessForActor(actor, params.data.id);
    if (!access) return reply.code(404).send({ success: false, message: "团队不存在" });
    if (!canReadTeam(actor, access)) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    const memberCount = sql<number>`(
      select count(*)::int from ${projectMembers} where ${projectMembers.projectId} = ${projects.id}
    )`;
    const rows = await db
      .select({
        id: projects.id,
        name: projects.name,
        status: projects.status,
        teamId: projects.teamId,
        memberCount,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .where(eq(projects.teamId, access.teamId))
      .orderBy(desc(projects.id));
    return { success: true, data: rows };
  });

  app.post("/api/admin/teams/:id/projects", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    const body = z.object({ name: z.string().trim().min(1).max(100) }).safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const actor = actorFrom(req);
    const access = await loadTeamAccessForActor(actor, params.data.id);
    if (!access) return reply.code(404).send({ success: false, message: "团队不存在" });
    if (!canAdminTeam(actor, access)) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    try {
      const [row] = await db
        .insert(projects)
        .values({ teamId: access.teamId, name: body.data.name, status: "active" })
        .returning({
          id: projects.id,
          name: projects.name,
          status: projects.status,
          teamId: projects.teamId,
          createdAt: projects.createdAt,
        });
      await writeOpsAudit({
        actorEmployeeId: actor.employeeId,
        action: "project.create",
        targetType: "project",
        targetId: String(row.id),
        detail: { name: row.name, teamId: access.teamId },
        ip: req.ip,
      });
      return { success: true, data: row };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("projects_team_name_uidx") || message.includes("unique")) {
        return reply.code(409).send({ success: false, message: "项目名称已存在" });
      }
      throw error;
    }
  });

  app.patch("/api/admin/projects/:id", async (req, reply) => {
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
    const [project] = await db
      .select({ id: projects.id, teamId: projects.teamId })
      .from(projects)
      .where(eq(projects.id, params.data.id))
      .limit(1);
    if (!project) return reply.code(404).send({ success: false, message: "项目不存在" });
    const actor = actorFrom(req);
    const access = await loadTeamAccessForActor(actor, project.teamId);
    if (!access || !canAdminTeam(actor, access)) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    try {
      const [row] = await db
        .update(projects)
        .set({ ...body.data, updatedAt: new Date() })
        .where(eq(projects.id, project.id))
        .returning({
          id: projects.id,
          name: projects.name,
          status: projects.status,
          teamId: projects.teamId,
        });
      await writeOpsAudit({
        actorEmployeeId: actor.employeeId,
        action: "project.update",
        targetType: "project",
        targetId: String(row.id),
        detail: { fields: Object.keys(body.data), name: row.name },
        ip: req.ip,
      });
      return { success: true, data: row };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("projects_team_name_uidx") || message.includes("unique")) {
        return reply.code(409).send({ success: false, message: "项目名称已存在" });
      }
      throw error;
    }
  });

  app.get("/api/admin/projects/:id/members", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ success: false, message: "参数无效" });
    const [project] = await db
      .select({ id: projects.id, teamId: projects.teamId, name: projects.name })
      .from(projects)
      .where(eq(projects.id, params.data.id))
      .limit(1);
    if (!project) return reply.code(404).send({ success: false, message: "项目不存在" });
    const actor = actorFrom(req);
    const access = await loadTeamAccessForActor(actor, project.teamId);
    if (!access || !canReadTeam(actor, access)) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    const rows = await db
      .select({
        id: projectMembers.id,
        employeeId: employees.id,
        name: employees.name,
        phone: employees.phone,
        dept: employees.dept,
        status: employees.status,
        createdAt: projectMembers.createdAt,
      })
      .from(projectMembers)
      .innerJoin(employees, eq(projectMembers.employeeId, employees.id))
      .where(eq(projectMembers.projectId, project.id))
      .orderBy(desc(projectMembers.id));
    return { success: true, data: rows, meta: { project } };
  });

  app.post("/api/admin/projects/:id/members", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    const body = z.object({ employeeId: z.number().int().positive() }).safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const [project] = await db
      .select({ id: projects.id, teamId: projects.teamId })
      .from(projects)
      .where(eq(projects.id, params.data.id))
      .limit(1);
    if (!project) return reply.code(404).send({ success: false, message: "项目不存在" });
    const actor = actorFrom(req);
    const access = await loadTeamAccessForActor(actor, project.teamId);
    if (!access || !canAdminTeam(actor, access)) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    const [membership] = await db
      .select({ employeeId: teamMembers.employeeId })
      .from(teamMembers)
      .where(
        and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.employeeId, body.data.employeeId)),
      )
      .limit(1);
    if (!membership) {
      return reply.code(400).send({ success: false, message: "请先将员工加入该团队" });
    }
    try {
      const [row] = await db
        .insert(projectMembers)
        .values({ projectId: project.id, employeeId: body.data.employeeId })
        .returning({ id: projectMembers.id, employeeId: projectMembers.employeeId });
      await writeOpsAudit({
        actorEmployeeId: actor.employeeId,
        action: "project.member_add",
        targetType: "project",
        targetId: String(project.id),
        detail: { employeeId: row.employeeId },
        ip: req.ip,
      });
      return { success: true, data: row };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("project_members_project_employee_uidx") || message.includes("unique")) {
        return reply.code(409).send({ success: false, message: "该员工已在项目中" });
      }
      throw error;
    }
  });

  app.delete("/api/admin/projects/:id/members/:employeeId", async (req, reply) => {
    const params = z
      .object({
        id: z.coerce.number().int().positive(),
        employeeId: z.coerce.number().int().positive(),
      })
      .safeParse(req.params);
    if (!params.success) return reply.code(400).send({ success: false, message: "参数无效" });
    const [project] = await db
      .select({ id: projects.id, teamId: projects.teamId })
      .from(projects)
      .where(eq(projects.id, params.data.id))
      .limit(1);
    if (!project) return reply.code(404).send({ success: false, message: "项目不存在" });
    const actor = actorFrom(req);
    const access = await loadTeamAccessForActor(actor, project.teamId);
    if (!access || !canAdminTeam(actor, access)) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    const deleted = await db
      .delete(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, project.id),
          eq(projectMembers.employeeId, params.data.employeeId),
        ),
      )
      .returning({ employeeId: projectMembers.employeeId });
    if (!deleted.length) return reply.code(404).send({ success: false, message: "成员不存在" });
    await writeOpsAudit({
      actorEmployeeId: actor.employeeId,
      action: "project.member_remove",
      targetType: "project",
      targetId: String(project.id),
      detail: { employeeId: params.data.employeeId },
      ip: req.ip,
    });
    return { success: true };
  });
}
