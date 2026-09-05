import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { teamMembers, teams } from "../db/schema/index.js";
import type { SessionRole } from "./jwt.js";

export const TEAM_ADMIN_ROLE = "team_admin" as const;
export const DEPT_ADMIN_ROLE = "dept_admin" as const;

export type OrgActor = {
  role: SessionRole;
  enterpriseId: number | null;
  employeeId: number;
  departmentIds?: number[];
};

export type TeamAccess = {
  teamId: number;
  enterpriseId: number;
  departmentId: number;
  memberRole: "member" | "team_admin" | null;
};

export function canManageEnterpriseOrg(role: SessionRole): boolean {
  return role === "admin" || role === "org_admin";
}

export function canUseOrgConsole(role: SessionRole): boolean {
  return role === "admin" || role === "org_admin" || role === "dept_admin" || role === "team_admin";
}

function actorDepartmentIds(actor: OrgActor): number[] {
  return actor.departmentIds ?? [];
}

export async function listAdminTeamIds(employeeId: number): Promise<number[]> {
  const rows = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(and(eq(teamMembers.employeeId, employeeId), eq(teamMembers.role, "team_admin")));
  return rows.map((row) => row.teamId);
}

export async function listAdminDepartmentIds(employeeId: number): Promise<number[]> {
  const rows = await db
    .select({ departmentId: teams.departmentId })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(eq(teamMembers.employeeId, employeeId));
  return [...new Set(rows.map((row) => row.departmentId))];
}

export async function listTeamIdsInDepartments(departmentIds: readonly number[]): Promise<number[]> {
  if (departmentIds.length === 0) return [];
  const rows = await db
    .select({ id: teams.id })
    .from(teams)
    .where(inArray(teams.departmentId, [...departmentIds]));
  return rows.map((row) => row.id);
}

export async function loadOrgActor(input: {
  role: SessionRole;
  enterpriseId: number | null;
  employeeId: number;
}): Promise<OrgActor> {
  const departmentIds =
    input.role === "dept_admin" ? await listAdminDepartmentIds(input.employeeId) : [];
  return { ...input, departmentIds };
}

export async function loadTeamAccess(teamId: number): Promise<TeamAccess | null> {
  const [row] = await db
    .select({
      teamId: teams.id,
      enterpriseId: teams.enterpriseId,
      departmentId: teams.departmentId,
    })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!row) return null;
  return { ...row, memberRole: null };
}

export async function loadTeamAccessForActor(
  actor: OrgActor,
  teamId: number,
): Promise<TeamAccess | null> {
  const [row] = await db
    .select({
      teamId: teams.id,
      enterpriseId: teams.enterpriseId,
      departmentId: teams.departmentId,
      memberRole: teamMembers.role,
    })
    .from(teams)
    .leftJoin(
      teamMembers,
      and(eq(teamMembers.teamId, teams.id), eq(teamMembers.employeeId, actor.employeeId)),
    )
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!row) return null;
  return {
    teamId: row.teamId,
    enterpriseId: row.enterpriseId,
    departmentId: row.departmentId,
    memberRole: row.memberRole ?? null,
  };
}

export function canReadTeam(actor: OrgActor, access: TeamAccess): boolean {
  if (actor.role === "admin") return true;
  if (actor.role === "org_admin" && actor.enterpriseId === access.enterpriseId) return true;
  if (
    actor.role === "dept_admin" &&
    actor.enterpriseId === access.enterpriseId &&
    actorDepartmentIds(actor).includes(access.departmentId)
  ) {
    return true;
  }
  return access.memberRole != null;
}

export function canAdminTeam(actor: OrgActor, access: TeamAccess): boolean {
  if (actor.role === "admin") return true;
  if (actor.role === "org_admin" && actor.enterpriseId === access.enterpriseId) return true;
  if (
    actor.role === "dept_admin" &&
    actor.enterpriseId === access.enterpriseId &&
    actorDepartmentIds(actor).includes(access.departmentId)
  ) {
    return true;
  }
  return access.memberRole === "team_admin";
}

export function canCreateTeam(
  actor: OrgActor,
  enterpriseId: number,
  departmentId?: number | null,
): boolean {
  if (actor.role === "admin") return enterpriseId > 0;
  if (actor.role === "org_admin") return actor.enterpriseId === enterpriseId;
  if (actor.role === "dept_admin") {
    return (
      actor.enterpriseId === enterpriseId &&
      departmentId != null &&
      actorDepartmentIds(actor).includes(departmentId)
    );
  }
  return false;
}

export function employeeSingleTeamConflictMessage(
  existing: { teamId: number; teamName: string } | null,
  targetTeamId: number,
): string | null {
  if (!existing) return null;
  if (existing.teamId === targetTeamId) return "该员工已在团队中";
  return `该员工已加入团队 ${existing.teamName}，一名员工只能属于一个团队`;
}

export function resolveTeamListScope(
  actor: OrgActor,
  requestedEnterpriseId: number | undefined,
  adminTeamIds: number[],
): { enterpriseId?: number; teamIds?: number[]; departmentIds?: number[] } | { forbidden: true } {
  if (actor.role === "admin") {
    return requestedEnterpriseId != null ? { enterpriseId: requestedEnterpriseId } : {};
  }
  if (actor.role === "org_admin") {
    if (actor.enterpriseId == null) return { forbidden: true };
    if (requestedEnterpriseId != null && requestedEnterpriseId !== actor.enterpriseId) {
      return { forbidden: true };
    }
    return { enterpriseId: actor.enterpriseId };
  }
  if (actor.role === "dept_admin") {
    const departmentIds = actorDepartmentIds(actor);
    if (departmentIds.length === 0) return { forbidden: true };
    return { departmentIds };
  }
  if (actor.role === "team_admin") {
    if (adminTeamIds.length === 0) return { forbidden: true };
    return { teamIds: adminTeamIds };
  }
  return { forbidden: true };
}
