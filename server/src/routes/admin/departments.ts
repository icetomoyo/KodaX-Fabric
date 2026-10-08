import type { FastifyInstance } from "fastify";

import { z } from "zod";
import { db } from "../../db/client.js";
import { count, and, desc, eq, inArray, sql } from "drizzle-orm";
import { credentialBindings, departments, enterprises, teamMembers, teams } from "../../db/schema/index.js";
import {
  dingtalkDeptIdConflictMessage,
  findDingtalkDeptIdOwner,
} from "../../lib/dingtalk-dept-id.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import { ORG_UNITS_SYNC_ONLY_MESSAGE } from "../../lib/enterprise.js";
import {
  canCreateTeam,
  loadOrgActor,
  resolveTeamListScope,
  type OrgActor,
} from "../../lib/org.js";
import { detachAndDeleteTeam } from "./teams.js";
import { departmentAndDescendantIds } from "../../lib/department-tree.js";
import type { SessionRole } from "../../lib/jwt.js";
import {
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

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

export async function adminDepartmentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requireRoles("admin", "org_admin", "dept_admin"));

  app.get("/api/admin/departments", async (req, reply) => {
    const query = z
      .object({
        enterpriseId: z.coerce.number().int().positive().optional(),
      })
      .safeParse(req.query);
    if (!query.success) return reply.code(400).send({ success: false, message: "参数无效" });
    const actor = await actorFrom(req);
    const scope = resolveTeamListScope(actor, query.data.enterpriseId, []);
    if ("forbidden" in scope) {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    let departmentIds: number[] | undefined;
    if (scope.departmentIds?.length) {
      departmentIds = scope.departmentIds;
    } else if (scope.teamIds?.length) {
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
        parentId: departments.parentId,
        dingtalkDeptId: departments.dingtalkDeptId,
        enterpriseId: departments.enterpriseId,
        enterpriseName: enterprises.name,
        teamCount,
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
    const tree = await db
      .select({ id: departments.id, parentId: departments.parentId })
      .from(departments);
    const memberships = await db
      .select({
        departmentId: teams.departmentId,
        employeeId: teamMembers.employeeId,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId));
    const employeesByDept = new Map<number, Set<number>>();
    for (const row of memberships) {
      const set = employeesByDept.get(row.departmentId) ?? new Set<number>();
      set.add(row.employeeId);
      employeesByDept.set(row.departmentId, set);
    }
    const subtreeMemberCount = (departmentId: number) => {
      const people = new Set<number>();
      for (const id of departmentAndDescendantIds(departmentId, tree)) {
        const set = employeesByDept.get(id);
        if (!set) continue;
        for (const employeeId of set) people.add(employeeId);
      }
      return people.size;
    };
    return {
      success: true,
      data: rows.map((row) => ({
        ...row,
        teamCount: Number(row.teamCount) || 0,
        memberCount: subtreeMemberCount(row.id),
        defaultTeamId: row.defaultTeamId == null ? null : Number(row.defaultTeamId),
      })),
    };
  });

  app.post("/api/admin/departments", async (_req, reply) => {
    return reply.code(403).send({ success: false, message: ORG_UNITS_SYNC_ONLY_MESSAGE });
  });

  app.patch("/api/admin/departments/:id", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    const body = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        status: z.enum(["active", "disabled"]).optional(),
        dingtalkDeptId: z.number().int().positive().nullable().optional(),
      })
      .refine((data) => Object.keys(data).length > 0)
      .safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const actor = await actorFrom(req);
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
    if (body.data.dingtalkDeptId != null) {
      const owner = await findDingtalkDeptIdOwner(body.data.dingtalkDeptId, {
        departmentId: department.id,
      });
      if (owner) {
        return reply.code(409).send({ success: false, message: dingtalkDeptIdConflictMessage(owner) });
      }
    }
    try {
      const [row] = await db
        .update(departments)
        .set({
          ...(body.data.name != null ? { name: body.data.name } : {}),
          ...(body.data.status != null ? { status: body.data.status } : {}),
          ...(body.data.dingtalkDeptId !== undefined ? { dingtalkDeptId: body.data.dingtalkDeptId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(departments.id, department.id))
        .returning({
          id: departments.id,
          name: departments.name,
          status: departments.status,
          parentId: departments.parentId,
          dingtalkDeptId: departments.dingtalkDeptId,
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
      if (message.includes("departments_dingtalk_dept_id_uidx")) {
        return reply.code(409).send({ success: false, message: "钉钉部门 ID 已存在" });
      }
      if (message.includes("departments_enterprise_name_uidx") || message.includes("unique")) {
        return reply.code(409).send({ success: false, message: "部门名称已存在" });
      }
      throw error;
    }
  });

  app.delete("/api/admin/departments/:id", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ success: false, message: "参数无效" });
    const actor = await actorFrom(req);
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
