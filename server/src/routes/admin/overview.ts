import type { FastifyInstance } from "fastify";
import { and, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import {
  employees,
  enterprises,
  modelRoutes,
  productLines,
  providers,
  requestAudits,
  teamMembers,
  teams,
  usageCountersTeamDaily,
} from "../../db/schema/index.js";
import { getChannelOverviewStats } from "../../lib/channel-overview.js";
import { listAdminDepartmentIds, listAdminTeamIds, listTeamIdsInDepartments } from "../../lib/org.js";
import { quotaDayAt, zonedDateRange } from "../../lib/quota-time.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

type TodayQueryOptions = {
  now?: Date;
  enterpriseId?: number;
  teamIds?: number[];
};

function quotaToday(now = new Date()) {
  return quotaDayAt(now, env.QUOTA_TIMEZONE);
}

export function todayAuditFilter(now = new Date()) {
  const today = quotaToday(now);
  const { start, endExclusive } = zonedDateRange(today, today, env.QUOTA_TIMEZONE);
  return and(
    gte(requestAudits.createdAt, start),
    lt(requestAudits.createdAt, endExclusive),
  )!;
}

export function buildTodayAuditWhere(now = new Date()) {
  return db.select({ n: count() }).from(requestAudits).where(todayAuditFilter(now));
}

export function buildTodayTeamTokensQuery(options: TodayQueryOptions = {}) {
  const today = quotaToday(options.now);
  const dayFilter = sql`${usageCountersTeamDaily.day} = ${today}`;
  if (options.enterpriseId != null) {
    return db
      .select({
        tokens: sql<number>`coalesce(sum(${usageCountersTeamDaily.totalTokens}), 0)`,
      })
      .from(usageCountersTeamDaily)
      .innerJoin(teams, eq(usageCountersTeamDaily.teamId, teams.id))
      .where(
        and(
          dayFilter,
          eq(teams.enterpriseId, options.enterpriseId),
          options.teamIds ? inArray(usageCountersTeamDaily.teamId, options.teamIds) : undefined,
        ),
      );
  }
  return db
    .select({
      tokens: sql<number>`coalesce(sum(${usageCountersTeamDaily.totalTokens}), 0)`,
    })
    .from(usageCountersTeamDaily)
    .where(
      and(
        dayFilter,
        options.teamIds ? inArray(usageCountersTeamDaily.teamId, options.teamIds) : undefined,
      ),
    );
}

export function buildTopTeamsTodayQuery(options: TodayQueryOptions = {}) {
  const today = quotaToday(options.now);
  return db
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
      and(
        sql`${usageCountersTeamDaily.day} = ${today}`,
        options.enterpriseId != null ? eq(teams.enterpriseId, options.enterpriseId) : undefined,
        options.teamIds ? inArray(usageCountersTeamDaily.teamId, options.teamIds) : undefined,
      ),
    )
    .groupBy(usageCountersTeamDaily.teamId, teams.name, enterprises.name)
    .orderBy(sql`sum(${usageCountersTeamDaily.totalTokens}) desc`)
    .limit(10);
}

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
        : and(todayAuditFilter(), sql`${requestAudits.status} <> 'success'`),
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
  const todayWhere = todayAuditFilter(now);
  const [today, tokenRow, topTeams, byProvider, errors] = await Promise.all([
    todayStats(todayWhere),
    buildTodayTeamTokensQuery({ now }).then((rows) => rows[0]),
    buildTopTeamsTodayQuery({ now }),
    byProviderToday(todayWhere),
    recentErrors(undefined),
  ]);
  return {
    role: "admin" as const,
    enterprises: { total: enterpriseCount.n, active: activeEnterprises.n },
    channels,
    providers: providerCount.n,
    modelRoutesEnabled: routeCount.n,
    today: {
      requests: today.requests,
      tokens: Number(tokenRow?.tokens ?? 0),
      errors: today.errors,
    },
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
  const now = new Date();
  const todayWhere = and(todayAuditFilter(now), eq(employees.enterpriseId, enterpriseId));
  const [today, tokenRow, topTeams, byProvider, errors] = await Promise.all([
    db
      .select({
        requests: sql<number>`count(*)::int`,
        errors: sql<number>`count(*) filter (where ${requestAudits.status} <> 'success')::int`,
      })
      .from(requestAudits)
      .innerJoin(employees, eq(requestAudits.employeeId, employees.id))
      .where(todayWhere)
      .then((rows) => ({
        requests: Number(rows[0]?.requests ?? 0),
        errors: Number(rows[0]?.errors ?? 0),
      })),
    buildTodayTeamTokensQuery({ now, enterpriseId }).then((rows) => rows[0]),
    buildTopTeamsTodayQuery({ now, enterpriseId }),
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
    today: {
      requests: today.requests,
      tokens: Number(tokenRow?.tokens ?? 0),
      errors: today.errors,
    },
    topTeamsToday: topTeams,
    byProviderToday: byProvider,
    recentErrors: errors,
  };
}

async function teamScopeOverview(teamIds: number[]) {
  if (teamIds.length === 0) {
    return {
      role: "team_admin" as const,
      team: { teamCount: 0, memberCount: 0 },
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
  const now = new Date();
  const todayWhere = and(todayAuditFilter(now), inArray(requestAudits.teamId, teamIds));
  const [today, tokenRow, topMembers, byProvider, errors] = await Promise.all([
    todayStats(todayWhere),
    buildTodayTeamTokensQuery({ now, teamIds }).then((rows) => rows[0]),
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
          sql`${usageCountersTeamDaily.day} = ${quotaToday(now)}`,
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
    },
    today: {
      requests: today.requests,
      tokens: Number(tokenRow?.tokens ?? 0),
      errors: today.errors,
    },
    topMembersToday: topMembers,
    byProviderToday: byProvider,
    recentErrors: errors,
  };
}

export async function adminOverviewRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin", "org_admin", "dept_admin", "team_admin"));

  app.get("/api/admin/overview", async (req, reply) => {
    const role = req.session!.role;
    if (role === "org_admin") {
      if (req.session!.enterpriseId == null) {
        return reply.code(403).send({ success: false, message: "权限不足" });
      }
      return { success: true, data: await enterpriseOverview(req.session!.enterpriseId) };
    }
    if (role === "dept_admin") {
      const teamIds = await listTeamIdsInDepartments(
        await listAdminDepartmentIds(req.employeeId!),
      );
      return { success: true, data: { ...(await teamScopeOverview(teamIds)), role: "dept_admin" } };
    }
    if (role === "team_admin") {
      const teamIds = await listAdminTeamIds(req.employeeId!);
      return { success: true, data: await teamScopeOverview(teamIds) };
    }
    return { success: true, data: await platformOverview() };
  });
}
