import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { modelPrices, requestAudits, teamMembers, teams, usageCountersTeamDaily } from "../db/schema/index.js";
import { parseYuanNumber, teamQuotaFitsPackage } from "./enterprise-package.js";
import { sumRequestCostYuanSql } from "./model-cost.js";

/** Member daily limits are stored in tokens and configured in millions. */
export const TOKEN_QUOTA_UNIT = 1_000_000;

export function isTokenQuotaUnit(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value % TOKEN_QUOTA_UNIT === 0;
}

export async function sumAssignedTeamQuota(
  enterpriseId: number,
  exceptTeamId?: number,
): Promise<number> {
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${teams.monthlyYuanQuota}), 0)`,
    })
    .from(teams)
    .where(
      exceptTeamId == null
        ? eq(teams.enterpriseId, enterpriseId)
        : and(eq(teams.enterpriseId, enterpriseId), ne(teams.id, exceptTeamId)),
    );
  return parseYuanNumber(row?.total);
}

export const teamQuotaFitsEnterprise = teamQuotaFitsPackage;

export type EmployeeTeamQuotaView = {
  teamId: number;
  teamName: string;
  teamQuota: number;
  teamUsedMonth: number;
  myLimit: number | null;
  myUsedToday: number;
};

export async function listEmployeeTeamQuotaViews(
  employeeId: number,
  day: string,
  monthRange: { start: Date; endExclusive: Date },
): Promise<EmployeeTeamQuotaView[]> {
  const memberships = await db
    .select({
      teamId: teams.id,
      teamName: teams.name,
      teamQuota: teams.monthlyYuanQuota,
      myLimit: teamMembers.dailyTokenLimit,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teamMembers.employeeId, employeeId));

  if (memberships.length === 0) return [];

  const teamIds = memberships.map((row) => row.teamId);
  const startAt = monthRange.start.toISOString();
  const endAt = monthRange.endExclusive.toISOString();
  const [usageRows, costRows] = await Promise.all([
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
        teamId: requestAudits.teamId,
        costYuan: sumRequestCostYuanSql,
      })
      .from(requestAudits)
      .leftJoin(modelPrices, eq(modelPrices.model, requestAudits.clientModel))
      .where(
        and(
          inArray(requestAudits.teamId, teamIds),
          sql`${requestAudits.createdAt} >= ${startAt}::timestamptz`,
          sql`${requestAudits.createdAt} < ${endAt}::timestamptz`,
        ),
      )
      .groupBy(requestAudits.teamId),
  ]);

  return memberships.map((row) => {
    const myUsed = usageRows.find(
      (usage) => usage.teamId === row.teamId && usage.employeeId === employeeId,
    );
    const cost = costRows.find((item) => item.teamId === row.teamId);
    return {
      teamId: row.teamId,
      teamName: row.teamName,
      teamQuota: parseYuanNumber(row.teamQuota),
      teamUsedMonth: parseYuanNumber(cost?.costYuan),
      myLimit: row.myLimit,
      myUsedToday: Number(myUsed?.totalTokens ?? 0),
    };
  });
}
