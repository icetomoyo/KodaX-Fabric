import type { FastifyInstance } from "fastify";
import { and, desc, eq, gt, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import {
  employees,
  enterprises,
  requestAudits,
  usageCountersDaily,
} from "../../db/schema/index.js";
import {
  computeRequestCredits,
  defaultCreditRateFor,
  isPeakHour,
} from "../../lib/relay/credit-cost.js";
import {
  addCalendarDays,
  parseDateOnly,
  quotaDayAt,
  zonedDateRange,
} from "../../lib/quota-time.js";
import { billedCacheReadTokensSql } from "../../lib/usage-cache.js";
import {
  avgTokensPerRequest,
  cacheHitRate,
  tokenComposition,
} from "../../lib/workbench-today.js";
import {
  buildContributionGrid,
  contributionStartSunday,
  fillHourCounts,
  usageStreaks,
  weekdayWeekendSplit,
} from "../../lib/user-analytics.js";
import { requireRoles, requireSession } from "../../middleware/auth.js";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function dateQuery(value: string | undefined, fallback: string): string | null {
  const day = value?.trim() || fallback;
  if (!DATE_ONLY.test(day) || !parseDateOnly(day)) return null;
  return day;
}

const departmentNameSql = sql<string | null>`(
  select d.name
  from team_members tm
  inner join teams t on t.id = tm.team_id
  inner join departments d on d.id = t.department_id
  where tm.employee_id = ${employees.id}
    and coalesce(d.is_default, false) = false
  order by d.id
  limit 1
)`;

/**
 * 排名读 writeRelayAudit 事务内维护的 usage_counters_daily 预聚合表
 * （与 request_audits 同事务写入、同 quota-day 口径），一次索引扫描替代
 * 对审计大表的当天全量 GROUP BY。totalTokens > 0 对应旧查询的 HAVING。
 */
export function buildUserAnalyticsRankQuery(day: string) {
  return db
    .select({
      employeeId: employees.id,
      name: employees.name,
      phone: employees.phone,
      usageTier: employees.usageTier,
      enterpriseName: enterprises.name,
      departmentName: departmentNameSql,
      promptTokens: usageCountersDaily.promptTokens,
      completionTokens: usageCountersDaily.completionTokens,
      totalTokens: usageCountersDaily.totalTokens,
      requestCount: usageCountersDaily.requestCount,
      errorCount: usageCountersDaily.errorCount,
    })
    .from(usageCountersDaily)
    .innerJoin(employees, eq(usageCountersDaily.employeeId, employees.id))
    .leftJoin(enterprises, eq(employees.enterpriseId, enterprises.id))
    .where(and(
      eq(usageCountersDaily.day, day),
      gt(usageCountersDaily.totalTokens, 0),
    ))
    .orderBy(
      desc(usageCountersDaily.totalTokens),
      desc(usageCountersDaily.requestCount),
      employees.id,
    )
    .limit(50);
}

export async function adminUserAnalyticsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requireRoles("admin"));

  app.get("/api/admin/user-analytics", async (req, reply) => {
    const today = quotaDayAt(new Date(), env.QUOTA_TIMEZONE);
    const query = z
      .object({
        day: z.string().optional(),
        employeeId: z.coerce.number().int().positive().optional(),
      })
      .safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const day = dateQuery(query.data.day, today);
    if (!day) {
      return reply.code(400).send({ success: false, message: "日期无效" });
    }
    if (day > today) {
      return reply.code(400).send({ success: false, message: "日期不能晚于今天" });
    }

    const ranks = (await buildUserAnalyticsRankQuery(day)).map((row, index) => ({
      rank: index + 1,
      employeeId: row.employeeId,
      name: row.name,
      phone: row.phone,
      usageTier: row.usageTier,
      enterpriseName: row.enterpriseName,
      departmentName: row.departmentName,
      promptTokens: Number(row.promptTokens) || 0,
      completionTokens: Number(row.completionTokens) || 0,
      totalTokens: Number(row.totalTokens) || 0,
      requestCount: Number(row.requestCount) || 0,
      errorCount: Number(row.errorCount) || 0,
    }));

    const selectedId = query.data.employeeId
      ?? ranks[0]?.employeeId
      ?? null;
    const selected = selectedId == null ? null : await loadSelectedUser(selectedId, day);

    return {
      success: true,
      data: {
        day,
        timezone: env.QUOTA_TIMEZONE,
        ranks,
        selected,
      },
    };
  });
}

async function loadSelectedUser(employeeId: number, day: string) {
  const [employee] = await db
    .select({
      id: employees.id,
      name: employees.name,
      phone: employees.phone,
      usageTier: employees.usageTier,
      lastLoginAt: employees.lastLoginAt,
      enterpriseName: enterprises.name,
      departmentName: departmentNameSql,
    })
    .from(employees)
    .leftJoin(enterprises, eq(employees.enterpriseId, enterprises.id))
    .where(eq(employees.id, employeeId))
    .limit(1);
  if (!employee) return null;

  const heatmapTo = day;
  const heatmapFrom = contributionStartSunday(heatmapTo);
  const heatmapRange = zonedDateRange(heatmapFrom, heatmapTo, env.QUOTA_TIMEZONE);
  const { start, endExclusive } = zonedDateRange(day, day, env.QUOTA_TIMEZONE);
  const dayKey = sql<string>`to_char((${requestAudits.createdAt} at time zone ${env.QUOTA_TIMEZONE}), 'YYYY-MM-DD')`;
  const hourBucket = sql<number>`extract(hour from (${requestAudits.createdAt} at time zone ${env.QUOTA_TIMEZONE}))::int`;
  const providerKey = sql<string>`coalesce(${requestAudits.providerCode}, 'unknown')`;
  const modelKey = sql<string>`lower(btrim(coalesce(${requestAudits.clientModel}, 'unknown')))`;
  const productKey = sql<string>`coalesce(${requestAudits.productType}::text, 'unknown')`;
  const dayFilter = and(
    eq(requestAudits.employeeId, employeeId),
    gte(requestAudits.createdAt, start),
    lt(requestAudits.createdAt, endExclusive),
  );

  const [dailyRows, hourlyRows, modelRows, providerRows, productRows, compositionRow, auditRows] = await Promise.all([
    db
      .select({
        day: dayKey,
        promptTokens: sql<number>`coalesce(sum(${requestAudits.promptTokens}), 0)`,
        completionTokens: sql<number>`coalesce(sum(${requestAudits.completionTokens}), 0)`,
        totalTokens: sql<number>`coalesce(sum(${requestAudits.totalTokens}), 0)`,
        requestCount: sql<number>`count(*)::int`,
        errorCount: sql<number>`count(*) filter (where ${requestAudits.status} <> 'success')::int`,
      })
      .from(requestAudits)
      .where(and(
        eq(requestAudits.employeeId, employeeId),
        gte(requestAudits.createdAt, heatmapRange.start),
        lt(requestAudits.createdAt, heatmapRange.endExclusive),
      ))
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db
      .select({
        hour: hourBucket,
        totalTokens: sql<number>`coalesce(sum(${requestAudits.totalTokens}), 0)`,
        requestCount: sql<number>`count(*)::int`,
      })
      .from(requestAudits)
      .where(dayFilter)
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db
      .select({
        key: modelKey,
        totalTokens: sql<number>`coalesce(sum(${requestAudits.totalTokens}), 0)`,
        requestCount: sql<number>`count(*)::int`,
      })
      .from(requestAudits)
      .where(dayFilter)
      .groupBy(sql`1`)
      .orderBy(desc(sql`coalesce(sum(${requestAudits.totalTokens}), 0)`))
      .limit(8),
    db
      .select({
        key: providerKey,
        totalTokens: sql<number>`coalesce(sum(${requestAudits.totalTokens}), 0)`,
        requestCount: sql<number>`count(*)::int`,
        errorCount: sql<number>`count(*) filter (where ${requestAudits.status} <> 'success')::int`,
      })
      .from(requestAudits)
      .where(dayFilter)
      .groupBy(sql`1`)
      .orderBy(desc(sql`coalesce(sum(${requestAudits.totalTokens}), 0)`))
      .limit(8),
    db
      .select({
        key: productKey,
        totalTokens: sql<number>`coalesce(sum(${requestAudits.totalTokens}), 0)`,
        requestCount: sql<number>`count(*)::int`,
      })
      .from(requestAudits)
      .where(dayFilter)
      .groupBy(sql`1`)
      .orderBy(desc(sql`coalesce(sum(${requestAudits.totalTokens}), 0)`)),
    db
      .select({
        promptTokens: sql<number>`coalesce(sum(${requestAudits.promptTokens}), 0)`,
        cacheReadTokens: sql<number>`coalesce(sum(${billedCacheReadTokensSql}), 0)`,
        completionTokens: sql<number>`coalesce(sum(${requestAudits.completionTokens}), 0)`,
        totalTokens: sql<number>`coalesce(sum(${requestAudits.totalTokens}), 0)`,
        requestCount: sql<number>`count(*)::int`,
        errorCount: sql<number>`count(*) filter (where ${requestAudits.status} <> 'success')::int`,
      })
      .from(requestAudits)
      .where(dayFilter)
      .then((rows) => rows[0]),
    db
      .select({
        promptTokens: requestAudits.promptTokens,
        completionTokens: requestAudits.completionTokens,
        cacheReadTokens: requestAudits.cacheReadTokens,
        clientModel: requestAudits.clientModel,
        createdAt: requestAudits.createdAt,
      })
      .from(requestAudits)
      .where(dayFilter)
      .orderBy(desc(requestAudits.createdAt), desc(requestAudits.id))
      // 多取 1 行用于判断是否截断；积分类 KPI 基于最近 5000 条估算
      .limit(5_001),
  ]);

  const detailTruncated = auditRows.length > 5_000;
  const detailRows = detailTruncated ? auditRows.slice(0, 5_000) : auditRows;

  const heatmap = buildContributionGrid(
    heatmapTo,
    dailyRows.map((row) => ({
      day: String(row.day),
      totalTokens: Number(row.totalTokens) || 0,
      requestCount: Number(row.requestCount) || 0,
    })),
  );
  const yearTotals = dailyRows.reduce(
    (sum, row) => ({
      totalTokens: sum.totalTokens + (Number(row.totalTokens) || 0),
      requestCount: sum.requestCount + (Number(row.requestCount) || 0),
      errorCount: sum.errorCount + (Number(row.errorCount) || 0),
    }),
    { totalTokens: 0, requestCount: 0, errorCount: 0 },
  );
  const streaks = usageStreaks(
    dailyRows.map((row) => ({ day: String(row.day), totalTokens: Number(row.totalTokens) || 0 })),
    heatmapTo,
  );
  const weekSplit = weekdayWeekendSplit(
    dailyRows.map((row) => ({ day: String(row.day), totalTokens: Number(row.totalTokens) || 0 })),
  );

  const promptTokens = Number(compositionRow?.promptTokens) || 0;
  const cacheReadTokens = Number(compositionRow?.cacheReadTokens) || 0;
  const completionTokens = Number(compositionRow?.completionTokens) || 0;
  const totalTokens = Number(compositionRow?.totalTokens) || 0;
  const requestCount = Number(compositionRow?.requestCount) || 0;
  const errorCount = Number(compositionRow?.errorCount) || 0;
  const composition = tokenComposition({ promptTokens, cacheReadTokens, completionTokens });
  const hourly = fillHourCounts(hourlyRows.map((row) => ({
    hour: Number(row.hour) || 0,
    totalTokens: Number(row.totalTokens) || 0,
    requestCount: Number(row.requestCount) || 0,
  })));
  const peakHour = hourly.reduce<{ hour: string; totalTokens: number } | null>((best, row) => {
    if (row.totalTokens <= 0) return best;
    if (!best || row.totalTokens > best.totalTokens) return { hour: row.hour, totalTokens: row.totalTokens };
    return best;
  }, null);

  let credits = 0;
  let peakCredits = 0;
  let offPeakCredits = 0;
  let peakTokens = 0;
  let offPeakTokens = 0;
  for (const row of detailRows) {
    const startedAt = row.createdAt;
    const tokens = (Number(row.promptTokens) || 0) + (Number(row.completionTokens) || 0);
    const peak = isPeakHour(startedAt);
    if (peak) peakTokens += tokens;
    else offPeakTokens += tokens;
    const amount = computeRequestCredits(
      {
        promptTokens: row.promptTokens ?? 0,
        completionTokens: row.completionTokens ?? 0,
        cacheReadTokens: row.cacheReadTokens ?? 0,
      },
      defaultCreditRateFor(row.clientModel),
      startedAt,
    );
    credits += amount;
    if (peak) peakCredits += amount;
    else offPeakCredits += amount;
  }

  const previousDay = addCalendarDays(day, -1);
  const previous = dailyRows.find((row) => String(row.day) === previousDay);

  return {
    employee: {
      id: employee.id,
      name: employee.name,
      phone: employee.phone,
      usageTier: employee.usageTier,
      lastLoginAt: employee.lastLoginAt,
      enterpriseName: employee.enterpriseName,
      departmentName: employee.departmentName,
    },
    heatmap,
    year: {
      from: heatmap.from,
      to: heatmap.to,
      ...yearTotals,
      ...streaks,
      ...weekSplit,
    },
    day: {
      totalTokens,
      promptTokens,
      completionTokens,
      requestCount,
      errorCount,
      successRate: requestCount === 0 ? null : Math.max(0, requestCount - errorCount) / requestCount,
      cacheReadTokens,
      cacheHitRate: cacheHitRate(cacheReadTokens, promptTokens),
      avgTokens: avgTokensPerRequest(totalTokens, requestCount),
      credits: roundCredits(credits),
      creditsEstimated: detailTruncated,
      peakCredits: roundCredits(peakCredits),
      offPeakCredits: roundCredits(offPeakCredits),
      peakTokens,
      offPeakTokens,
      previousTokens: previous ? Number(previous.totalTokens) || 0 : 0,
      peakHour,
      hourly,
      composition,
      byModel: modelRows.map((row) => ({
        key: row.key,
        totalTokens: Number(row.totalTokens) || 0,
        requestCount: Number(row.requestCount) || 0,
      })),
      byProvider: providerRows.map((row) => ({
        key: row.key,
        totalTokens: Number(row.totalTokens) || 0,
        requestCount: Number(row.requestCount) || 0,
        errorCount: Number(row.errorCount) || 0,
      })),
      byProductType: productRows.map((row) => ({
        key: row.key,
        totalTokens: Number(row.totalTokens) || 0,
        requestCount: Number(row.requestCount) || 0,
      })),
    },
  };
}

function roundCredits(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
