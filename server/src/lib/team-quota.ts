import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { teamMembers, teams, usageCountersTeamDaily } from "../db/schema/index.js";

export type EmployeeTeamUsageView = {
  teamId: number;
  teamName: string;
  teamUsedMonth: number;
  myUsedToday: number;
};

export async function listEmployeeTeamUsageViews(
  employeeId: number,
  day: string,
  monthRange: { from: string; to: string },
): Promise<EmployeeTeamUsageView[]> {
  const memberships = await db
    .select({
      teamId: teams.id,
      teamName: teams.name,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teamMembers.employeeId, employeeId));

  if (memberships.length === 0) return [];

  const teamIds = memberships.map((row) => row.teamId);
  const [usageRows, monthRows] = await Promise.all([
    db
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
      ),
    db
      .select({
        teamId: usageCountersTeamDaily.teamId,
        totalTokens: sql<number>`coalesce(sum(${usageCountersTeamDaily.totalTokens}), 0)`,
      })
      .from(usageCountersTeamDaily)
      .where(
        and(
          inArray(usageCountersTeamDaily.teamId, teamIds),
          gte(usageCountersTeamDaily.day, monthRange.from),
          lte(usageCountersTeamDaily.day, monthRange.to),
        ),
      )
      .groupBy(usageCountersTeamDaily.teamId),
  ]);

  return memberships.map((row) => {
    const myUsed = usageRows.find(
      (usage) => usage.teamId === row.teamId && usage.employeeId === employeeId,
    );
    const monthUsed = monthRows.find((item) => item.teamId === row.teamId);
    return {
      teamId: row.teamId,
      teamName: row.teamName,
      teamUsedMonth: Number(monthUsed?.totalTokens ?? 0),
      myUsedToday: Number(myUsed?.totalTokens ?? 0),
    };
  });
}
