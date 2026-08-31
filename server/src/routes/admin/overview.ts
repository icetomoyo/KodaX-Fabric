import type { FastifyInstance } from "fastify";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  employees,
  enterprises,
  modelRoutes,
  productLines,
  projects,
  providers,
  requestAudits,
  teamMembers,
  teams,
  usageCountersTeamDaily,
} from "../../db/schema/index.js";
import { getChannelOverviewStats } from "../../lib/channel-overview.js";
import { listAdminTeamIds } from "../../lib/org.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

const todayExpr = sql`${requestAudits.createdAt}::date = current_date`;

async function todayStats(whereClause: ReturnType<typeof and> | undefined) {
  const [todayReqs] = await db
    .select({ n: count() })
    .from(requestAudits)
    .where(whereClause);
  const [todayTokens] = await db
    .select({
      tokens: sql<number>`coalesce(sum(${requestAudits.totalTokens}), 0)`,
    })
    .from(requestAudits)
    .where(whereClause);
  const [todayErrors] = await db
    .select({ n: count() })
    .from(requestAudits)
    .where(
      whereClause
        ? and(whereClause, sql`${requestAudits.status} <> 'success'`)
        : sql`${requestAudits.status} <> 'success' and ${todayExpr}`,
    );
  return {
    requests: Number(todayReqs?.n ?? 0),
    tokens: Number(todayTokens?.tokens ?? 0),
    errors: Number(todayErrors?.n ?? 0),
  };
}

/** Prefer the stored provider; if the call failed before a credential was chosen, use the Key's channel. */
export const resolvedProviderCodeSql = sql<string | null>`coalesce(${requestAudits.providerCode}, ${providers.code})`;

export function buildByProviderTodayQuery(whereClause: ReturnType<typeof and> | undefined) {
  return db
    .select({
      providerCode: resolvedProviderCodeSql,
      requests: sql<number>`count(*)::int`,
      tokens: sql<number>`coalesce(sum(${requestAudits.totalTokens}), 0)`,
    })
    .from(requestAudits)
    .leftJoin(productLines, eq(requestAudits.productLineId, productLines.id))
    .leftJoin(providers, eq(productLines.providerId, providers.id))
    .innerJoin(employees, eq(requestAudits.employeeId, employees.id))
    .where(whereClause)
    .groupBy(resolvedProviderCodeSql)
    .orderBy(sql`count(*) desc`);
}

async function byProviderToday(whereClause: ReturnType<typeof and> | undefined) {
  return buildByProviderTodayQuery(whereClause);
}

async function recentErrors(whereClause: ReturnType<typeof and> | undefined) {
  return db
    .select({
      requestId: requestAudits.requestId,
      enterpriseName: enterprises.name,
      teamName: teams.name,
      employeeName: employees.name,
      clientModel: requestAudits.clientModel,
      providerCode: requestAudits.providerCode,
      status: requestAudits.status,
      createdAt: requestAudits.createdAt,
    })
    .from(requestAudits)
    .innerJoin(employees, eq(requestAudits.employeeId, employees.id))
    .leftJoin(enterprises, eq(employees.enterpriseId, enterprises.id))
    .leftJoin(teams, eq(requestAudits.teamId, teams.id))
    .where(whereClause ? and(whereClause, sql`${requestAudits.status} <> 'success'`) : sql`${requestAudits.status} <> 'success'`)
    .orderBy(desc(requestAudits.id))
    .limit(10);
}

async function platformOverview() {
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
  const todayWhere = and(todayExpr);
  const [today, topTeams, byProvider, errors] = await Promise.all([
    todayStats(todayWhere),
    db
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
      .groupBy(usageCountersTeamDaily.teamId, teams.name, enterprises.name)
      .orderBy(sql`sum(${usageCountersTeamDaily.totalTokens}) desc`)
      .limit(10),
    byProviderToday(todayWhere),
    recentErrors(undefined),
  ]);
  return {
    role: "admin" as const,
    enterprises: { total: enterpriseCount.n, active: activeEnterprises.n },
    channels,
    providers: providerCount.n,
    modelRoutesEnabled: routeCount.n,
    today,
    topTeamsToday: topTeams,
    byProviderToday: byProvider,
    recentErrors: errors,
  };
}

async function enterpriseOverview(enterpriseId: number) {
  const [enterprise] = await db
    .select({
      name: enterprises.name,
    })
    .from(enterprises)
    .where(eq(enterprises.id, enterpriseId))
    .limit(1);
  const [teamCount] = await db
    .select({ n: count() })
    .from(teams)
    .where(eq(teams.enterpriseId, enterpriseId));
  const [employeeCount] = await db
    .select({ n: count() })
    .from(employees)
    .where(eq(employees.enterpriseId, enterpriseId));
  const todayWhere = and(todayExpr, eq(employees.enterpriseId, enterpriseId));
  const [today, topTeams, byProvider, errors] = await Promise.all([
    db
      .select({
        requests: sql<number>`count(*)::int`,
        tokens: sql<number>`coalesce(sum(${requestAudits.totalTokens}), 0)`,
        errors: sql<number>`count(*) filter (where ${requestAudits.status} <> 'success')::int`,
      })
      .from(requestAudits)
      .innerJoin(employees, eq(requestAudits.employeeId, employees.id))
      .where(todayWhere)
      .then((rows) => ({
        requests: Number(rows[0]?.requests ?? 0),
        tokens: Number(rows[0]?.tokens ?? 0),
        errors: Number(rows[0]?.errors ?? 0),
      })),
    db
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
      .where(
        and(eq(teams.enterpriseId, enterpriseId), sql`${usageCountersTeamDaily.day} = current_date`),
      )
      .groupBy(usageCountersTeamDaily.teamId, teams.name, enterprises.name)
      .orderBy(sql`sum(${usageCountersTeamDaily.totalTokens}) desc`)
      .limit(10),
    byProviderToday(todayWhere),
    db
      .select({
        requestId: requestAudits.requestId,
        enterpriseName: enterprises.name,
        teamName: teams.name,
        employeeName: employees.name,
        clientModel: requestAudits.clientModel,
        providerCode: requestAudits.providerCode,
        status: requestAudits.status,
        createdAt: requestAudits.createdAt,
      })
      .from(requestAudits)
      .innerJoin(employees, eq(requestAudits.employeeId, employees.id))
      .leftJoin(enterprises, eq(employees.enterpriseId, enterprises.id))
      .leftJoin(teams, eq(requestAudits.teamId, teams.id))
      .where(and(eq(employees.enterpriseId, enterpriseId), sql`${requestAudits.status} <> 'success'`))
      .orderBy(desc(requestAudits.id))
      .limit(10),
  ]);
  return {
    role: "org_admin" as const,
    org: {
      name: enterprise?.name ?? "",
      teamCount: Number(teamCount?.n ?? 0),
      employeeCount: Number(employeeCount?.n ?? 0),
    },
    today,
    topTeamsToday: topTeams,
    byProviderToday: byProvider,
    recentErrors: errors,
  };
}

async function teamScopeOverview(teamIds: number[]) {
  if (teamIds.length === 0) {
    return {
      role: "team_admin" as const,
      team: { teamCount: 0, memberCount: 0, projectCount: 0 },
      today: { requests: 0, tokens: 0, errors: 0 },
      topMembersToday: [],
      byProviderToday: [],
      recentErrors: [],
    };
  }
  const [memberCount] = await db
    .select({ n: count() })
    .from(teamMembers)
    .where(inArray(teamMembers.teamId, teamIds));
  const [projectCount] = await db
    .select({ n: count() })
    .from(projects)
    .where(inArray(projects.teamId, teamIds));
  const todayWhere = and(todayExpr, inArray(requestAudits.teamId, teamIds));
  const [today, topMembers, byProvider, errors] = await Promise.all([
    todayStats(todayWhere),
    db
      .select({
        employeeId: usageCountersTeamDaily.employeeId,
        employeeName: employees.name,
        totalTokens: sql<number>`coalesce(sum(${usageCountersTeamDaily.totalTokens}), 0)`,
        requestCount: sql<number>`coalesce(sum(${usageCountersTeamDaily.requestCount}), 0)`,
      })
      .from(usageCountersTeamDaily)
      .innerJoin(employees, eq(usageCountersTeamDaily.employeeId, employees.id))
      .where(
        and(
          inArray(usageCountersTeamDaily.teamId, teamIds),
          sql`${usageCountersTeamDaily.day} = current_date`,
        ),
      )
      .groupBy(usageCountersTeamDaily.employeeId, employees.name)
      .orderBy(sql`sum(${usageCountersTeamDaily.totalTokens}) desc`)
      .limit(10),
    byProviderToday(todayWhere),
    recentErrors(and(inArray(requestAudits.teamId, teamIds))),
  ]);
  return {
    role: "team_admin" as const,
    team: {
      teamCount: teamIds.length,
      memberCount: Number(memberCount?.n ?? 0),
      projectCount: Number(projectCount?.n ?? 0),
    },
    today,
    topMembersToday: topMembers,
    byProviderToday: byProvider,
    recentErrors: errors,
  };
}

export async function adminOverviewRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin", "org_admin", "team_admin"));

  app.get("/api/admin/overview", async (req, reply) => {
    const role = req.session!.role;
    if (role === "org_admin") {
      if (req.session!.enterpriseId == null) {
        return reply.code(403).send({ success: false, message: "权限不足" });
      }
      return { success: true, data: await enterpriseOverview(req.session!.enterpriseId) };
    }
    if (role === "team_admin") {
      const teamIds = await listAdminTeamIds(req.employeeId!);
      return { success: true, data: await teamScopeOverview(teamIds) };
    }
    return { success: true, data: await platformOverview() };
  });
}
