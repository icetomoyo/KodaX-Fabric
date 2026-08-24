import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { teamMembers, teams, usageCountersTeamDaily } from "../db/schema/index.js";

export type EmployeeTeamQuotaView = {
  teamId: number;
  teamName: string;
  teamQuota: number;
  teamUsedToday: number;
  myLimit: number | null;
  myUsedToday: number;
};

export async function listEmployeeTeamQuotaViews(
  employeeId: number,
  day: string,
): Promise<EmployeeTeamQuotaView[]> {
  const memberships = await db
    .select({
      teamId: teams.id,
      teamName: teams.name,
      teamQuota: teams.dailyTokenQuota,
      myLimit: teamMembers.dailyTokenLimit,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teamMembers.employeeId, employeeId));

  if (memberships.length === 0) return [];

  const teamIds = memberships.map((row) => row.teamId);
  const usageRows = await db
    .select({
      teamId: usageCountersTeamDaily.teamId,
      employeeId: usageCountersTeamDaily.employeeId,
      totalTokens: usageCountersTeamDaily.totalTokens,
    })
    .from(usageCountersTeamDaily)
    .where(
      and(
        inArray(usageCountersTeamDaily.teamId, teamIds),
        eq(usageCountersTeamDaily.day, day),
      ),
    );

  return memberships.map((row) => {
    const teamUsedToday = usageRows
      .filter((usage) => usage.teamId === row.teamId)
      .reduce((sum, usage) => sum + Number(usage.totalTokens), 0);
    const myUsed = usageRows.find(
      (usage) => usage.teamId === row.teamId && usage.employeeId === employeeId,
    );
    return {
      teamId: row.teamId,
      teamName: row.teamName,
      teamQuota: Number(row.teamQuota),
      teamUsedToday,
      myLimit: row.myLimit,
      myUsedToday: Number(myUsed?.totalTokens ?? 0),
    };
  });
}
