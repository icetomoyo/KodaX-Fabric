import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { teamMembers, teams } from "../db/schema/index.js";
import type { SessionRole } from "./jwt.js";

export const TEAM_ADMIN_ROLE = "team_admin" as const;

export type OrgActor = {
  role: SessionRole;
  enterpriseId: number | null;
  employeeId: number;
};

export type TeamAccess = {
  teamId: number;
  enterpriseId: number;
  memberRole: "member" | "team_admin" | null;
};

export function canManageEnterpriseOrg(role: SessionRole): boolean {
  return role === "admin" || role === "org_admin";
}

export function canUseOrgConsole(role: SessionRole): boolean {
  return role === "admin" || role === "org_admin" || role === "team_admin";
}

export async function listAdminTeamIds(employeeId: number): Promise<number[]> {
  const rows = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(and(eq(teamMembers.employeeId, employeeId), eq(teamMembers.role, "team_admin")));
  return rows.map((row) => row.teamId);
}

export async function loadTeamAccess(teamId: number): Promise<TeamAccess | null> {
  const [row] = await db
    .select({
      teamId: teams.id,
      enterpriseId: teams.enterpriseId,
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
    memberRole: row.memberRole ?? null,
  };
}

export function canReadTeam(actor: OrgActor, access: TeamAccess): boolean {
  if (actor.role === "admin") return true;
  if (actor.role === "org_admin" && actor.enterpriseId === access.enterpriseId) return true;
  return access.memberRole != null;
}

export function canAdminTeam(actor: OrgActor, access: TeamAccess): boolean {
  if (actor.role === "admin") return true;
  if (actor.role === "org_admin" && actor.enterpriseId === access.enterpriseId) return true;
  return access.memberRole === "team_admin";
}

export function canCreateTeam(actor: OrgActor, enterpriseId: number): boolean {
  if (actor.role === "admin") return enterpriseId > 0;
  return actor.role === "org_admin" && actor.enterpriseId === enterpriseId;
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
): { enterpriseId?: number; teamIds?: number[] } | { forbidden: true } {
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
  if (actor.role === "team_admin") {
    if (adminTeamIds.length === 0) return { forbidden: true };
    return { teamIds: adminTeamIds };
  }
  return { forbidden: true };
}
