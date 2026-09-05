import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, count, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import {
  departments,
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
import { inclusiveDayCount, quotaDayAt, zonedDateRange, zonedMonthRange } from "../../lib/quota-time.js";
import { fillDailyUsage, summarizeDailyUsage } from "../../lib/user-usage.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

type TodayQueryOptions = {
  now?: Date;
  from?: string;
  to?: string;
  enterpriseId?: number;
  departmentIds?: number[];
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

function usageDayFilter(options: TodayQueryOptions): SQL {
  if (options.from && options.to) {
    return and(
      sql`${usageCountersTeamDaily.day} >= ${options.from}`,
      sql`${usageCountersTeamDaily.day} <= ${options.to}`,
    )!;
  }
  return sql`${usageCountersTeamDaily.day} = ${quotaToday(options.now)}`;
}

function scopeUsageWhere(dayFilter: SQL, options: TodayQueryOptions) {
  return and(
    dayFilter,
    options.enterpriseId != null ? eq(teams.enterpriseId, options.enterpriseId) : undefined,
    options.departmentIds ? inArray(teams.departmentId, options.departmentIds) : undefined,
    options.teamIds ? inArray(usageCountersTeamDaily.teamId, options.teamIds) : undefined,
  );
}

function needsTeamJoin(options: TodayQueryOptions) {
  return options.enterpriseId != null || Boolean(options.departmentIds);
}

export function buildTodayTeamTokensQuery(options: TodayQueryOptions = {}) {
  const dayFilter = usageDayFilter(options);
  const query = db
    .select({
      tokens: sql<number>`coalesce(sum(${usageCountersTeamDaily.totalTokens}), 0)`,
    })
    .from(usageCountersTeamDaily);
  if (needsTeamJoin(options)) {
    return query
      .innerJoin(teams, eq(usageCountersTeamDaily.teamId, teams.id))
      .where(scopeUsageWhere(dayFilter, options));
  }
  return query.where(
    and(
      dayFilter,
      options.teamIds ? inArray(usageCountersTeamDaily.teamId, options.teamIds) : undefined,
    ),
  );
}

export function buildMonthTeamTokensQuery(options: TodayQueryOptions = {}) {
  const month = zonedMonthRange(options.now ?? new Date(), env.QUOTA_TIMEZONE);
  const dayFilter = and(
    sql`${usageCountersTeamDaily.day} >= ${month.from}`,
    sql`${usageCountersTeamDaily.day} <= ${month.to}`,
  )!;
  const query = db
    .select({
      tokens: sql<number>`coalesce(sum(${usageCountersTeamDaily.totalTokens}), 0)`,
    })
    .from(usageCountersTeamDaily);
  if (needsTeamJoin(options)) {
    return query
      .innerJoin(teams, eq(usageCountersTeamDaily.teamId, teams.id))
      .where(scopeUsageWhere(dayFilter, options));
  }
  return query.where(
    and(
      dayFilter,
      options.teamIds ? inArray(usageCountersTeamDaily.teamId, options.teamIds) : undefined,
    ),
  );
}

export function buildTopEnterprisesTodayQuery(options: TodayQueryOptions = {}) {
  return db
    .select({
      enterpriseId: enterprises.id,
      enterpriseName: enterprises.name,
      totalTokens: sql<number>`coalesce(sum(${usageCountersTeamDaily.totalTokens}), 0)`,
      requestCount: sql<number>`coalesce(sum(${usageCountersTeamDaily.requestCount}), 0)`,
    })
    .from(usageCountersTeamDaily)
    .innerJoin(teams, eq(usageCountersTeamDaily.teamId, teams.id))
    .innerJoin(enterprises, eq(teams.enterpriseId, enterprises.id))
    .where(scopeUsageWhere(usageDayFilter(options), options))
    .groupBy(enterprises.id, enterprises.name)
    .orderBy(sql`sum(${usageCountersTeamDaily.totalTokens}) desc`)
    .limit(10);
}

export function buildTopDepartmentsTodayQuery(options: TodayQueryOptions = {}) {
  return db
    .select({
      departmentId: departments.id,
      departmentName: departments.name,
      enterpriseName: enterprises.name,
      totalTokens: sql<number>`coalesce(sum(${usageCountersTeamDaily.totalTokens}), 0)`,
      requestCount: sql<number>`coalesce(sum(${usageCountersTeamDaily.requestCount}), 0)`,
    })
    .from(usageCountersTeamDaily)
    .innerJoin(teams, eq(usageCountersTeamDaily.teamId, teams.id))
    .innerJoin(departments, eq(teams.departmentId, departments.id))
    .innerJoin(enterprises, eq(teams.enterpriseId, enterprises.id))
    .where(scopeUsageWhere(usageDayFilter(options), options))
    .groupBy(departments.id, departments.name, enterprises.name)
    .orderBy(sql`sum(${usageCountersTeamDaily.totalTokens}) desc`)
    .limit(10);
}

export function buildTopTeamsTodayQuery(options: TodayQueryOptions = {}) {
  return db
    .select({
      teamId: usageCountersTeamDaily.teamId,
      teamName: teams.name,
      departmentName: departments.name,
      enterpriseName: enterprises.name,
      totalTokens: sql<number>`coalesce(sum(${usageCountersTeamDaily.totalTokens}), 0)`,
      requestCount: sql<number>`coalesce(sum(${usageCountersTeamDaily.requestCount}), 0)`,
    })
    .from(usageCountersTeamDaily)
    .innerJoin(teams, eq(usageCountersTeamDaily.teamId, teams.id))
    .innerJoin(departments, eq(teams.departmentId, departments.id))
    .innerJoin(enterprises, eq(teams.enterpriseId, enterprises.id))
    .where(
      and(
        scopeUsageWhere(usageDayFilter(options), options),
        eq(teams.isDefault, false),
      ),
    )
    .groupBy(usageCountersTeamDaily.teamId, teams.name, departments.name, enterprises.name)
    .orderBy(sql`sum(${usageCountersTeamDaily.totalTokens}) desc`)
    .limit(10);
}

export function buildTopMembersTodayQuery(options: TodayQueryOptions = {}) {
  return db
    .select({
      employeeId: usageCountersTeamDaily.employeeId,
      employeeName: employees.name,
      teamName: teams.name,
      teamIsDefault: teams.isDefault,
      departmentName: departments.name,
      enterpriseName: enterprises.name,
      totalTokens: sql<number>`coalesce(sum(${usageCountersTeamDaily.totalTokens}), 0)`,
      requestCount: sql<number>`coalesce(sum(${usageCountersTeamDaily.requestCount}), 0)`,
    })
    .from(usageCountersTeamDaily)
    .innerJoin(employees, eq(usageCountersTeamDaily.employeeId, employees.id))
    .innerJoin(teams, eq(usageCountersTeamDaily.teamId, teams.id))
    .innerJoin(departments, eq(teams.departmentId, departments.id))
    .innerJoin(enterprises, eq(teams.enterpriseId, enterprises.id))
    .where(scopeUsageWhere(usageDayFilter(options), options))
    .groupBy(
      usageCountersTeamDaily.employeeId,
      employees.name,
      teams.name,
      teams.isDefault,
      departments.name,
      enterprises.name,
    )
    .orderBy(sql`sum(${usageCountersTeamDaily.totalTokens}) desc`)
    .limit(10);
}

export function buildAnalyticsDailyTrendQuery(from: string, to: string) {
  return db
    .select({
      day: usageCountersTeamDaily.day,
      promptTokens: sql<number>`coalesce(sum(${usageCountersTeamDaily.promptTokens}), 0)`,
      completionTokens: sql<number>`coalesce(sum(${usageCountersTeamDaily.completionTokens}), 0)`,
      totalTokens: sql<number>`coalesce(sum(${usageCountersTeamDaily.totalTokens}), 0)`,
      requestCount: sql<number>`coalesce(sum(${usageCountersTeamDaily.requestCount}), 0)`,
      errorCount: sql<number>`coalesce(sum(${usageCountersTeamDaily.errorCount}), 0)`,
    })
    .from(usageCountersTeamDaily)
    .where(and(
      sql`${usageCountersTeamDaily.day} >= ${from}`,
      sql`${usageCountersTeamDaily.day} <= ${to}`,
    ))
    .groupBy(usageCountersTeamDaily.day)
    .orderBy(asc(usageCountersTeamDaily.day));
}

export function analyticsHourBucketSql(timeZone: string) {
  return sql<string>`to_char((${requestAudits.createdAt} at time zone ${timeZone}), 'YYYY-MM-DD HH24:00')`;
}

export function buildAnalyticsHourlyTrendQuery(start: Date, endExclusive: Date, timeZone: string) {
  const bucket = analyticsHourBucketSql(timeZone);
  return db
    .select({
      bucket,
      promptTokens: sql<number>`coalesce(sum(${requestAudits.promptTokens}), 0)`,
      completionTokens: sql<number>`coalesce(sum(${requestAudits.completionTokens}), 0)`,
      totalTokens: sql<number>`coalesce(sum(${requestAudits.totalTokens}), 0)`,
      requestCount: sql<number>`count(*)::int`,
      errorCount: sql<number>`count(*) filter (where ${requestAudits.status} <> 'success')::int`,
    })
    .from(requestAudits)
    .where(and(
      gte(requestAudits.createdAt, start),
      lt(requestAudits.createdAt, endExclusive),
    ))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
}

export function buildAnalyticsByModelQuery(start: Date, endExclusive: Date) {
  const modelKey = sql<string>`coalesce(${requestAudits.clientModel}, 'unknown')`;
  return db
    .select({
      key: modelKey,
      totalTokens: sql<number>`coalesce(sum(${requestAudits.totalTokens}), 0)`,
      requestCount: sql<number>`count(*)::int`,
    })
    .from(requestAudits)
    .where(and(
      gte(requestAudits.createdAt, start),
      lt(requestAudits.createdAt, endExclusive),
    ))
    .groupBy(modelKey)
    .orderBy(desc(sql`coalesce(sum(${requestAudits.totalTokens}), 0)`), asc(modelKey))
    .limit(12);
}

export function buildAnalyticsByProviderQuery(start: Date, endExclusive: Date) {
  return db
    .select({
      key: resolvedProviderCodeSql,
      totalTokens: sql<number>`coalesce(sum(${requestAudits.totalTokens}), 0)`,
      requestCount: sql<number>`count(*)::int`,
    })
    .from(requestAudits)
    .leftJoin(productLines, eq(requestAudits.productLineId, productLines.id))
    .leftJoin(providers, eq(productLines.providerId, providers.id))
    .where(and(
      gte(requestAudits.createdAt, start),
      lt(requestAudits.createdAt, endExclusive),
    ))
    .groupBy(resolvedProviderCodeSql)
    .orderBy(desc(sql`coalesce(sum(${requestAudits.totalTokens}), 0)`))
    .limit(12);
}

export function buildAnalyticsErrorsByProviderQuery(start: Date, endExclusive: Date) {
  return db
    .select({
      key: resolvedProviderCodeSql,
      requestCount: sql<number>`count(*)::int`,
    })
    .from(requestAudits)
    .leftJoin(productLines, eq(requestAudits.productLineId, productLines.id))
    .leftJoin(providers, eq(productLines.providerId, providers.id))
    .where(and(
      gte(requestAudits.createdAt, start),
      lt(requestAudits.createdAt, endExclusive),
      sql`${requestAudits.status} <> 'success'`,
    ))
    .groupBy(resolvedProviderCodeSql)
    .orderBy(desc(sql`count(*)`))
    .limit(12);
}

function padHour(hour: number) {
  return String(hour).padStart(2, "0");
}

function fillHourlyTrend(
  day: string,
  rows: Array<{
    bucket: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    requestCount: number;
    errorCount: number;
  }>,
) {
  const byBucket = new Map(rows.map((row) => [row.bucket, row]));
  return Array.from({ length: 24 }, (_, hour) => {
    const bucket = `${day} ${padHour(hour)}:00`;
    const row = byBucket.get(bucket);
    const promptTokens = Number(row?.promptTokens) || 0;
    const completionTokens = Number(row?.completionTokens) || 0;
    const totalTokens = Number(row?.totalTokens) || 0;
    const requestCount = Number(row?.requestCount) || 0;
    const errorCount = Number(row?.errorCount) || 0;
    return {
      day: bucket,
      promptTokens,
      completionTokens,
      totalTokens,
      requestCount,
      errorCount,
      successRate: requestCount === 0 ? null : Math.max(0, requestCount - errorCount) / requestCount,
    };
  });
}

async function loadPlatformAnalytics(from: string, to: string) {
  const { start, endExclusive } = zonedDateRange(from, to, env.QUOTA_TIMEZONE);
  const hourly = from === to;
  const [trendRows, byModel, byProvider, errorsByProvider, ranks] = await Promise.all([
    hourly
      ? buildAnalyticsHourlyTrendQuery(start, endExclusive, env.QUOTA_TIMEZONE)
      : buildAnalyticsDailyTrendQuery(from, to),
    buildAnalyticsByModelQuery(start, endExclusive),
    buildAnalyticsByProviderQuery(start, endExclusive),
    buildAnalyticsErrorsByProviderQuery(start, endExclusive),
    usageRanksToday({ from, to }),
  ]);
  const trend = hourly
    ? fillHourlyTrend(from, trendRows.map((row) => ({
      bucket: String((row as { bucket: string }).bucket),
      promptTokens: Number(row.promptTokens) || 0,
      completionTokens: Number(row.completionTokens) || 0,
      totalTokens: Number(row.totalTokens) || 0,
      requestCount: Number(row.requestCount) || 0,
      errorCount: Number(row.errorCount) || 0,
    })))
    : fillDailyUsage(from, to, trendRows.map((row) => ({
      day: String((row as { day: string }).day),
      promptTokens: Number(row.promptTokens) || 0,
      completionTokens: Number(row.completionTokens) || 0,
      totalTokens: Number(row.totalTokens) || 0,
      requestCount: Number(row.requestCount) || 0,
      errorCount: Number(row.errorCount) || 0,
    })));
  return {
    range: { from, to, timezone: env.QUOTA_TIMEZONE, granularity: hourly ? "hour" : "day" },
    summary: summarizeDailyUsage(trend),
    trend,
    byModel: byModel.map((row) => ({
      key: row.key || "unknown",
      totalTokens: Number(row.totalTokens) || 0,
      requestCount: Number(row.requestCount) || 0,
    })),
    byProvider: byProvider.map((row) => ({
      key: row.key || "unknown",
      totalTokens: Number(row.totalTokens) || 0,
      requestCount: Number(row.requestCount) || 0,
    })),
    errorsByProvider: errorsByProvider.map((row) => ({
      key: row.key || "unknown",
      requestCount: Number(row.requestCount) || 0,
    })),
    ...ranks,
  };
}

async function usageRanksToday(options: TodayQueryOptions = {}) {
  const [topEnterprises, topDepartments, topTeams, topMembers] = await Promise.all([
    buildTopEnterprisesTodayQuery(options),
    buildTopDepartmentsTodayQuery(options),
    buildTopTeamsTodayQuery(options),
    buildTopMembersTodayQuery(options),
  ]);
  return {
    topEnterprisesToday: topEnterprises,
    topDepartmentsToday: topDepartments,
    topTeamsToday: topTeams,
    topMembersToday: topMembers,
  };
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
      departmentName: departments.name,
      teamName: teams.name,
      teamIsDefault: teams.isDefault,
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
    .leftJoin(departments, eq(teams.departmentId, departments.id))
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
  const [today, tokenRow, ranks, byProvider, errors] = await Promise.all([
    todayStats(todayWhere),
    buildTodayTeamTokensQuery({ now }).then((rows) => rows[0]),
    usageRanksToday({ now }),
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
    ...ranks,
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
  const [today, tokenRow, monthRow, ranks, byProvider, errors] = await Promise.all([
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
    buildMonthTeamTokensQuery({ now, enterpriseId }).then((rows) => rows[0]),
    usageRanksToday({ now, enterpriseId }),
    byProviderToday(todayWhere),
    recentErrors(and(eq(employees.enterpriseId, enterpriseId))),
  ]);
  return {
    role: "org_admin" as const,
    org: {
      name: enterprise?.name ?? "",
      teamCount: Number(teamCount?.n ?? 0),
      employeeCount: Number(employeeCount?.n ?? 0),
      monthUsedTokens: Number(monthRow?.tokens ?? 0),
    },
    today: {
      requests: today.requests,
      tokens: Number(tokenRow?.tokens ?? 0),
      errors: today.errors,
    },
    ...ranks,
    byProviderToday: byProvider,
    recentErrors: errors,
  };
}

async function teamScopeOverview(teamIds: number[]) {
  if (teamIds.length === 0) {
    return {
      role: "team_admin" as const,
      team: { teamCount: 0, memberCount: 0, monthUsedTokens: 0 },
      today: { requests: 0, tokens: 0, errors: 0 },
      topEnterprisesToday: [],
      topDepartmentsToday: [],
      topTeamsToday: [],
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
  const [today, tokenRow, monthRow, ranks, byProvider, errors] = await Promise.all([
    todayStats(todayWhere),
    buildTodayTeamTokensQuery({ now, teamIds }).then((rows) => rows[0]),
    buildMonthTeamTokensQuery({ now, teamIds }).then((rows) => rows[0]),
    usageRanksToday({ now, teamIds }),
    byProviderToday(todayWhere),
    recentErrors(and(inArray(requestAudits.teamId, teamIds))),
  ]);
  return {
    role: "team_admin" as const,
    team: {
      teamCount: teamIds.length,
      memberCount: Number(memberCount?.n ?? 0),
      monthUsedTokens: Number(monthRow?.tokens ?? 0),
    },
    today: {
      requests: today.requests,
      tokens: Number(tokenRow?.tokens ?? 0),
      errors: today.errors,
    },
    ...ranks,
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

  app.get("/api/admin/overview/analytics", async (req, reply) => {
    if (req.session!.role !== "admin") {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    const query = z.object({ from: z.string(), to: z.string() }).strict().safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const dayCount = inclusiveDayCount(query.data.from, query.data.to);
    if (dayCount === null || dayCount < 1 || dayCount > 90) {
      return reply.code(400).send({
        success: false,
        message: dayCount !== null && dayCount > 90 ? "日期范围最多 90 天" : "日期范围无效",
      });
    }
    return { success: true, data: await loadPlatformAnalytics(query.data.from, query.data.to) };
  });
}
