import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { employees, projectMembers, projects, teamMembers, teams } from "../../db/schema/index.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import {
  canAdminTeam,
  listAdminTeamIds,
  loadTeamAccessForActor,
  type OrgActor,
} from "../../lib/org.js";
import type { SessionRole } from "../../lib/jwt.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

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

export async function removeEmployeeFromTeamProjects(teamId: number, employeeId: number) {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.teamId, teamId));
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return;
  await db
    .delete(projectMembers)
    .where(and(eq(projectMembers.employeeId, employeeId), inArray(projectMembers.projectId, ids)));
}

export async function adminProjectRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("team_admin"));

  app.get("/api/admin/projects", async (req) => {
    const actor = actorFrom(req);
    const teamIds = await listAdminTeamIds(actor.employeeId);
    if (teamIds.length === 0) return { success: true, data: [] };
    const memberCount = sql<number>`(
      select count(*)::int from ${projectMembers} where ${projectMembers.projectId} = ${projects.id}
    )`;
    const rows = await db
      .select({
        id: projects.id,
        name: projects.name,
        status: projects.status,
        teamId: projects.teamId,
        teamName: teams.name,
        memberCount,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .innerJoin(teams, eq(projects.teamId, teams.id))
      .where(inArray(projects.teamId, teamIds))
      .orderBy(desc(projects.id));
    return {
      success: true,
      data: rows.map((row) => ({ ...row, memberCount: Number(row.memberCount) })),
    };
  });

  app.post("/api/admin/projects", async (req, reply) => {
    const body = z
      .object({
        teamId: z.number().int().positive(),
        name: z.string().trim().min(1).max(100),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ success: false, message: "参数无效" });
    const actor = actorFrom(req);
    const access = await loadTeamAccessForActor(actor, body.data.teamId);
    if (!access || !canAdminTeam(actor, access)) {
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
        detail: { name: row.name, teamId: row.teamId },
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
    const actor = actorFrom(req);
    const [project] = await db
      .select({ id: projects.id, teamId: projects.teamId })
      .from(projects)
      .where(eq(projects.id, params.data.id))
      .limit(1);
    if (!project) return reply.code(404).send({ success: false, message: "项目不存在" });
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
        detail: { fields: Object.keys(body.data), name: row.name, status: row.status },
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
    const actor = actorFrom(req);
    const [project] = await db
      .select({ id: projects.id, teamId: projects.teamId })
      .from(projects)
      .where(eq(projects.id, params.data.id))
      .limit(1);
    if (!project) return reply.code(404).send({ success: false, message: "项目不存在" });
    const access = await loadTeamAccessForActor(actor, project.teamId);
    if (!access || !canAdminTeam(actor, access)) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    const rows = await db
      .select({
        id: projectMembers.id,
        employeeId: employees.id,
        name: employees.name,
        phone: employees.phone,
        dept: employees.dept,
        teamRole: teamMembers.role,
        createdAt: projectMembers.createdAt,
      })
      .from(projectMembers)
      .innerJoin(employees, eq(projectMembers.employeeId, employees.id))
      .leftJoin(
        teamMembers,
        and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.employeeId, employees.id)),
      )
      .where(eq(projectMembers.projectId, project.id))
      .orderBy(desc(projectMembers.id));
    return { success: true, data: rows };
  });

  app.post("/api/admin/projects/:id/members", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    const body = z.object({ employeeId: z.number().int().positive() }).safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const actor = actorFrom(req);
    const [project] = await db
      .select({ id: projects.id, teamId: projects.teamId })
      .from(projects)
      .where(eq(projects.id, params.data.id))
      .limit(1);
    if (!project) return reply.code(404).send({ success: false, message: "项目不存在" });
    const access = await loadTeamAccessForActor(actor, project.teamId);
    if (!access || !canAdminTeam(actor, access)) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    const [membership] = await db
      .select({ employeeId: teamMembers.employeeId })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, project.teamId),
          eq(teamMembers.employeeId, body.data.employeeId),
        ),
      )
      .limit(1);
    if (!membership) {
      return reply.code(400).send({ success: false, message: "只能添加本团队成员" });
    }
    try {
      const [row] = await db
        .insert(projectMembers)
        .values({ projectId: project.id, employeeId: body.data.employeeId })
        .returning({
          id: projectMembers.id,
          employeeId: projectMembers.employeeId,
        });
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
    const actor = actorFrom(req);
    const [project] = await db
      .select({ id: projects.id, teamId: projects.teamId })
      .from(projects)
      .where(eq(projects.id, params.data.id))
      .limit(1);
    if (!project) return reply.code(404).send({ success: false, message: "项目不存在" });
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
