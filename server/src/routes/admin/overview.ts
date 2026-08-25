import type { FastifyInstance } from "fastify";
import { count, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  employees,
  enterprises,
  modelRoutes,
  providers,
  requestAudits,
  teams,
  usageCountersTeamDaily,
} from "../../db/schema/index.js";
import { getChannelOverviewStats } from "../../lib/channel-overview.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

export async function adminOverviewRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin"));

  app.get("/api/admin/overview", async () => {
    const now = new Date();
    const [enterpriseCount] = await db.select({ n: count() }).from(enterprises);
    const [activeEnterprises] = await db
      .select({ n: count() })
      .from(enterprises)
      .where(eq(enterprises.status, "active"));
    const channels = await getChannelOverviewStats(now);
    const [providerCount] = await db.select({ n: count() }).from(providers);
    const [routeCount] = await db
      .select({ n: count() })
      .from(modelRoutes)
      .where(eq(modelRoutes.enabled, true));

    const [todayReqs] = await db
      .select({ n: count() })
      .from(requestAudits)
      .where(sql`${requestAudits.createdAt}::date = current_date`);
    const [todayTokens] = await db
      .select({
        tokens: sql<number>`coalesce(sum(${requestAudits.totalTokens}), 0)`,
      })
      .from(requestAudits)
      .where(sql`${requestAudits.createdAt}::date = current_date`);
    const [todayErrors] = await db
      .select({ n: count() })
      .from(requestAudits)
      .where(
        sql`${requestAudits.createdAt}::date = current_date and ${requestAudits.status} <> 'success'`,
      );

    const topTeams = await db
      .select({
        teamId: usageCountersTeamDaily.teamId,
        teamName: teams.name,
        enterpriseName: enterprises.name,
        totalTokens: sql<number>`coalesce(sum(${usageCountersTeamDaily.totalTokens}), 0)`,
        requestCount: sql<number>`coalesce(sum(${usageCountersTeamDaily.requestCount}), 0)`,
      })
      .from(usageCountersTeamDaily)
      .innerJoin(teams, eq(usageCountersTeamDaily.teamId, teams.id))
      .innerJoin(enterprises, eq(teams.enterpriseId, enterprises.id))
      .where(sql`${usageCountersTeamDaily.day} = current_date`)
      .groupBy(
        usageCountersTeamDaily.teamId,
        teams.name,
        enterprises.name,
      )
      .orderBy(sql`sum(${usageCountersTeamDaily.totalTokens}) desc`)
      .limit(10);

    const byProvider = await db
      .select({
        providerCode: requestAudits.providerCode,
        requests: sql<number>`count(*)::int`,
        tokens: sql<number>`coalesce(sum(${requestAudits.totalTokens}), 0)`,
      })
      .from(requestAudits)
      .where(sql`${requestAudits.createdAt}::date = current_date`)
      .groupBy(requestAudits.providerCode)
      .orderBy(sql`count(*) desc`);

    const recentErrors = await db
      .select({
        requestId: requestAudits.requestId,
        enterpriseName: enterprises.name,
        teamName: teams.name,
        clientModel: requestAudits.clientModel,
        providerCode: requestAudits.providerCode,
        status: requestAudits.status,
        errorCode: requestAudits.errorCode,
        errorMessage: requestAudits.errorMessage,
        createdAt: requestAudits.createdAt,
      })
      .from(requestAudits)
      .innerJoin(employees, eq(requestAudits.employeeId, employees.id))
      .leftJoin(enterprises, eq(employees.enterpriseId, enterprises.id))
      .leftJoin(teams, eq(requestAudits.teamId, teams.id))
      .where(sql`${requestAudits.status} <> 'success'`)
      .orderBy(desc(requestAudits.id))
      .limit(10);

    return {
      success: true,
      data: {
        enterprises: { total: enterpriseCount.n, active: activeEnterprises.n },
        channels,
        providers: providerCount.n,
        modelRoutesEnabled: routeCount.n,
        today: {
          requests: todayReqs.n,
          tokens: Number(todayTokens.tokens ?? 0),
          errors: todayErrors.n,
        },
        topTeamsToday: topTeams,
        byProviderToday: byProvider,
        recentErrors,
      },
    };
  });
}
