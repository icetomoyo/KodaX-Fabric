import type { FastifyInstance } from "fastify";

import { z } from "zod";
import { db } from "../../db/client.js";
import { count, and, desc, eq, inArray, sql } from "drizzle-orm";
import { credentialBindings, departments, enterprises, teamMembers, teams } from "../../db/schema/index.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import { ensureDefaultTeam } from "../../lib/enterprise.js";
import { canCreateTeam, listAdminTeamIds, resolveTeamListScope, type OrgActor } from "../../lib/org.js";
import { detachAndDeleteTeam } from "./teams.js";
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

export async function adminDepartmentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin", "org_admin", "team_admin"));

  app.get("/api/admin/departments", async (req, reply) => {
    const query = z
      .object({
        enterpriseId: z.coerce.number().int().positive().optional(),
      })
      .safeParse(req.query);
    if (!query.success) return reply.code(400).send({ success: false, message: "参数无效" });
    const actor = actorFrom(req);
    const adminTeamIds = actor.role === "team_admin" ? await listAdminTeamIds(actor.employeeId) : [];
    const scope = resolveTeamListScope(actor, query.data.enterpriseId, adminTeamIds);
    if ("forbidden" in scope) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    let departmentIds: number[] | undefined;
    if (scope.teamIds?.length) {
      const teamRows = await db
        .select({ departmentId: teams.departmentId })
        .from(teams)
        .where(inArray(teams.id, scope.teamIds));
      departmentIds = [...new Set(teamRows.map((row) => row.departmentId))];
      if (departmentIds.length === 0) return { success: true, data: [] };
    }
    const teamCount = sql<number>`(
      select count(*)::int from ${teams}
      where ${teams.departmentId} = ${departments.id} and ${teams.isDefault} = false
    )`;
    const memberCount = sql<number>`(
      select count(*)::int from ${teamMembers}
      inner join ${teams} on ${teams.id} = ${teamMembers.teamId}
      where ${teams.departmentId} = ${departments.id}
    )`;
    const defaultTeamId = sql<number | null>`(
      select ${teams.id} from ${teams}
      where ${teams.departmentId} = ${departments.id} and ${teams.isDefault} = true
      limit 1
    )`;
    const rows = await db
      .select({
        id: departments.id,
        name: departments.name,
        status: departments.status,
        isDefault: departments.isDefault,
        enterpriseId: departments.enterpriseId,
        enterpriseName: enterprises.name,
        teamCount,
        memberCount,
        defaultTeamId,
        createdAt: departments.createdAt,
        updatedAt: departments.updatedAt,
      })
      .from(departments)
      .innerJoin(enterprises, eq(departments.enterpriseId, enterprises.id))
      .where(
        and(
          scope.enterpriseId != null ? eq(departments.enterpriseId, scope.enterpriseId) : sql`true`,
          departmentIds?.length ? inArray(departments.id, departmentIds) : sql`true`,
        ),
      )
      .orderBy(desc(departments.id));
    return {
      success: true,
      data: rows.map((row) => ({
        ...row,
        teamCount: Number(row.teamCount) || 0,
        memberCount: Number(row.memberCount) || 0,
        defaultTeamId: row.defaultTeamId == null ? null : Number(row.defaultTeamId),
      })),
    };
  });

  app.post("/api/admin/departments", async (req, reply) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(100),
        enterpriseId: z.number().int().positive().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ success: false, message: "参数无效" });
    const actor = actorFrom(req);
    if (actor.role !== "admin" && actor.role !== "org_admin") {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    const enterpriseId =
      actor.role === "org_admin"
        ? actor.enterpriseId
        : body.data.enterpriseId ?? (actor.role === "admin" ? null : actor.enterpriseId);
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
        .insert(departments)
        .values({ enterpriseId, name: body.data.name, status: "active" })
        .returning({
          id: departments.id,
          name: departments.name,
          status: departments.status,
          isDefault: departments.isDefault,
          enterpriseId: departments.enterpriseId,
          createdAt: departments.createdAt,
        });
      const defaultTeamId = await ensureDefaultTeam(row.id, enterpriseId);
      await writeOpsAudit({
        actorEmployeeId: actor.employeeId,
        action: "department.create",
        targetType: "department",
        targetId: String(row.id),
        detail: { name: row.name, enterpriseId, defaultTeamId },
        ip: req.ip,
      });
      return { success: true, data: { ...row, defaultTeamId, teamCount: 0 } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("departments_enterprise_name_uidx") || message.includes("unique")) {
        return reply.code(409).send({ success: false, message: "部门名称已存在" });
      }
      throw error;
    }
  });

  app.patch("/api/admin/departments/:id", async (req, reply) => {
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
    const [department] = await db
      .select({
        id: departments.id,
        enterpriseId: departments.enterpriseId,
      })
      .from(departments)
      .where(eq(departments.id, params.data.id))
      .limit(1);
    if (!department) return reply.code(404).send({ success: false, message: "部门不存在" });
    if (!canCreateTeam(actor, department.enterpriseId)) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    try {
      const [row] = await db
        .update(departments)
        .set({
          ...(body.data.name != null ? { name: body.data.name } : {}),
          ...(body.data.status != null ? { status: body.data.status } : {}),
          updatedAt: new Date(),
        })
        .where(eq(departments.id, department.id))
        .returning({
          id: departments.id,
          name: departments.name,
          status: departments.status,
          enterpriseId: departments.enterpriseId,
        });
      await writeOpsAudit({
        actorEmployeeId: actor.employeeId,
        action: "department.update",
        targetType: "department",
        targetId: String(row.id),
        detail: { fields: Object.keys(body.data), name: row.name },
        ip: req.ip,
      });
      return { success: true, data: row };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("departments_enterprise_name_uidx") || message.includes("unique")) {
        return reply.code(409).send({ success: false, message: "部门名称已存在" });
      }
      throw error;
    }
  });

  app.delete("/api/admin/departments/:id", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ success: false, message: "参数无效" });
    const actor = actorFrom(req);
    if (actor.role !== "admin" && actor.role !== "org_admin") {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    const [department] = await db
      .select({
        id: departments.id,
        name: departments.name,
        enterpriseId: departments.enterpriseId,
      })
      .from(departments)
      .where(eq(departments.id, params.data.id))
      .limit(1);
    if (!department) return reply.code(404).send({ success: false, message: "部门不存在" });
    if (!canCreateTeam(actor, department.enterpriseId)) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    const childTeams = await db
      .select({ id: teams.id, isDefault: teams.isDefault })
      .from(teams)
      .where(eq(teams.departmentId, department.id));
    if (childTeams.some((row) => !row.isDefault)) {
      return reply.code(409).send({ success: false, message: "部门下已绑定团队，无法删除" });
    }
    const teamIds = childTeams.map((row) => row.id);
    if (teamIds.length) {
      const [members] = await db
        .select({ n: count() })
        .from(teamMembers)
        .where(inArray(teamMembers.teamId, teamIds));
      if (Number(members?.n ?? 0) > 0) {
        return reply.code(409).send({ success: false, message: "部门下已绑定员工，无法删除" });
      }
    }
    for (const team of childTeams) {
      await detachAndDeleteTeam(team.id);
    }
    await db
      .delete(credentialBindings)
      .where(
        and(eq(credentialBindings.scopeType, "department"), eq(credentialBindings.scopeId, department.id)),
      );
    await db.delete(departments).where(eq(departments.id, department.id));
    await writeOpsAudit({
      actorEmployeeId: actor.employeeId,
      action: "department.delete",
      targetType: "department",
      targetId: String(department.id),
      detail: { name: department.name },
      ip: req.ip,
    });
    return { success: true };
  });
}
