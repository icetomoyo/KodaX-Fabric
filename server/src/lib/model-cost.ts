import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { employees, modelPrices, requestAudits, teams } from "../db/schema/index.js";
import { addCalendarDays, enumerateDays, formatUtcDate, quotaDayAt } from "./quota-time.js";
import { billedCacheReadTokensSql, billedUncachedPromptTokensSql } from "./usage-cache.js";

/** CNY cost for one audit row. Missing prices contribute 0.
 *  Cache hits are billed at cache-hit price, not full input price.
 *  Cache storage is hourly and is not included (audits have no TTL). */
export const requestCostYuanExpr = sql<string>`(
  ${billedUncachedPromptTokensSql}::numeric / 1000000
    * coalesce(${modelPrices.promptPricePerMillion}, 0)
  + ${billedCacheReadTokensSql}::numeric / 1000000
    * coalesce(${modelPrices.cacheHitPricePerMillion}, 0)
  + coalesce(${requestAudits.completionTokens}, 0)::numeric / 1000000
    * coalesce(${modelPrices.completionPricePerMillion}, 0)
)`;

export const sumRequestCostYuanSql = sql<string>`coalesce(sum(${requestCostYuanExpr}), 0)`;

export function teamTodayCostYuanSql(start: Date, endExclusive: Date) {
  const startAt = start.toISOString();
  const endAt = endExclusive.toISOString();
  return sql<string>`(
    select ${sumRequestCostYuanSql}
    from ${requestAudits}
    left join ${modelPrices} on ${modelPrices.model} = ${requestAudits.clientModel}
    where ${requestAudits.teamId} = ${teams.id}
      and ${requestAudits.createdAt} >= ${startAt}::timestamptz
      and ${requestAudits.createdAt} < ${endAt}::timestamptz
  )`;
}

export function memberTodayCostYuanSql(teamId: number, start: Date, endExclusive: Date) {
  const startAt = start.toISOString();
  const endAt = endExclusive.toISOString();
  return sql<string>`(
    select ${sumRequestCostYuanSql}
    from ${requestAudits}
    left join ${modelPrices} on ${modelPrices.model} = ${requestAudits.clientModel}
    where ${requestAudits.teamId} = ${teamId}
      and ${requestAudits.employeeId} = ${employees.id}
      and ${requestAudits.createdAt} >= ${startAt}::timestamptz
      and ${requestAudits.createdAt} < ${endAt}::timestamptz
  )`;
}

function sqlTimeZone(timeZone: string) {
  if (!/^[A-Za-z0-9_+\-/]+$/.test(timeZone)) {
    throw new Error("invalid time zone");
  }
  return sql.raw(`'${timeZone}'`);
}

function createdAtWindow(start: Date, endExclusive: Date) {
  const startAt = start.toISOString();
  const endAt = endExclusive.toISOString();
  return and(
    sql`${requestAudits.createdAt} >= ${startAt}::timestamptz`,
    sql`${requestAudits.createdAt} < ${endAt}::timestamptz`,
  );
}

export function buildTeamUsageDailyQuery(input: {
  teamId: number;
  start: Date;
  endExclusive: Date;
  timeZone: string;
}) {
  const dayKey = sql<string>`((${requestAudits.createdAt} at time zone ${sqlTimeZone(input.timeZone)})::date)`;
  return db
    .select({
      day: dayKey,
      totalTokens: sql<number>`coalesce(sum(${requestAudits.totalTokens}), 0)`,
      requestCount: sql<number>`count(*)::int`,
      costYuan: sumRequestCostYuanSql,
    })
    .from(requestAudits)
    .leftJoin(modelPrices, eq(modelPrices.model, requestAudits.clientModel))
    .where(and(eq(requestAudits.teamId, input.teamId), createdAtWindow(input.start, input.endExclusive)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
}

export function buildTeamUsageByModelQuery(input: {
  teamId: number;
  start: Date;
  endExclusive: Date;
}) {
  return db
    .select({
      model: requestAudits.clientModel,
      totalTokens: sql<number>`coalesce(sum(${requestAudits.totalTokens}), 0)`,
      costYuan: sumRequestCostYuanSql,
      priced: sql<boolean>`(${modelPrices.id} is not null)`,
    })
    .from(requestAudits)
    .leftJoin(modelPrices, eq(modelPrices.model, requestAudits.clientModel))
    .where(and(eq(requestAudits.teamId, input.teamId), createdAtWindow(input.start, input.endExclusive)))
    .groupBy(requestAudits.clientModel, modelPrices.id)
    .orderBy(desc(sql`coalesce(sum(${requestAudits.totalTokens}), 0)`), asc(requestAudits.clientModel));
}

export function defaultUsageRange(now: Date, timeZone: string): { from: string; to: string } {
  const to = quotaDayAt(now, timeZone);
  return { from: addCalendarDays(to, -29), to };
}

/** Format a SQL numeric as CNY with 2 decimal places. Avoids exposing raw JS floats. */
export function formatYuan(value: string | number | null | undefined): string {
  if (value == null) return "0.00";
  const raw = typeof value === "number" ? value.toString() : value.trim();
  if (!raw) return "0.00";
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  if (!/^\d+(\.\d+)?$/.test(unsigned)) return "0.00";
  const [intRaw, fracRaw = ""] = unsigned.split(".");
  const intPart = intRaw.replace(/^0+(?=\d)/, "") || "0";
  const frac3 = `${fracRaw}000`.slice(0, 3);
  let frac2 = Number(frac3.slice(0, 2));
  let intVal = BigInt(intPart);
  if (Number(frac3[2]) >= 5) {
    frac2 += 1;
    if (frac2 >= 100) {
      frac2 = 0;
      intVal += 1n;
    }
  }
  const sign = negative && intVal !== 0n ? "-" : "";
  return `${sign}${intVal.toString()}.${String(frac2).padStart(2, "0")}`;
}

function scaledTokenCost(tokens: number, pricePerMillion: string): string {
  const safeTokens = Number.isFinite(tokens) && tokens > 0 ? Math.trunc(tokens) : 0;
  if (safeTokens === 0) return "0";
  const [intPart, frac = ""] = pricePerMillion.split(".");
  const priceScale = frac.length;
  const priceDigits = BigInt(`${intPart}${frac}` || "0");
  const numer = BigInt(safeTokens) * priceDigits;
  const denom = 1_000_000n * 10n ** BigInt(priceScale);
  const outScale = 8n;
  const scaled = (numer * 10n ** outScale) / denom;
  const text = scaled.toString().padStart(Number(outScale) + 1, "0");
  return `${text.slice(0, text.length - Number(outScale))}.${text.slice(text.length - Number(outScale))}`;
}

function addPositiveDecimals(left: string, right: string): string {
  const leftFrac = (left.split(".")[1] ?? "").length;
  const rightFrac = (right.split(".")[1] ?? "").length;
  const scale = Math.max(leftFrac, rightFrac, 2);
  const toScaled = (value: string) => {
    const [whole, frac = ""] = value.split(".");
    return BigInt(whole || "0") * 10n ** BigInt(scale) + BigInt((frac + "0".repeat(scale)).slice(0, scale) || "0");
  };
  const sum = toScaled(left) + toScaled(right);
  const text = sum.toString().padStart(scale + 1, "0");
  return `${text.slice(0, text.length - scale)}.${text.slice(text.length - scale)}`;
}

export type ModelTokenPrice = {
  promptPricePerMillion: string;
  completionPricePerMillion: string;
  cacheHitPricePerMillion?: string;
};

/** Reference implementation of the SQL cost formula (unpriced models are 0). */
export function computeCostYuan(
  promptTokens: number,
  completionTokens: number,
  price: ModelTokenPrice | null,
  cacheReadTokens = 0,
): string {
  if (!price) return "0.00";
  const prompt = Number.isFinite(promptTokens) && promptTokens > 0 ? Math.trunc(promptTokens) : 0;
  const cacheRead =
    Number.isFinite(cacheReadTokens) && cacheReadTokens > 0
      ? Math.min(prompt, Math.trunc(cacheReadTokens))
      : 0;
  return formatYuan(
    addPositiveDecimals(
      addPositiveDecimals(
        scaledTokenCost(prompt - cacheRead, price.promptPricePerMillion),
        scaledTokenCost(cacheRead, price.cacheHitPricePerMillion ?? "0"),
      ),
      scaledTokenCost(completionTokens, price.completionPricePerMillion),
    ),
  );
}

function normalizeDay(value: string | Date): string {
  if (value instanceof Date) return formatUtcDate(value);
  const text = String(value);
  return text.length >= 10 ? text.slice(0, 10) : text;
}

export function fillDailyTeamUsage(
  from: string,
  to: string,
  rows: Array<{
    day: string | Date;
    totalTokens: number | string;
    requestCount: number | string;
    costYuan: string | number;
  }>,
): Array<{ day: string; totalTokens: number; requestCount: number; costYuan: string }> {
  const byDay = new Map(rows.map((row) => [normalizeDay(row.day), row]));
  return enumerateDays(from, to).map((day) => {
    const row = byDay.get(day);
    return {
      day,
      totalTokens: Number(row?.totalTokens ?? 0),
      requestCount: Number(row?.requestCount ?? 0),
      costYuan: formatYuan(row?.costYuan ?? "0"),
    };
  });
}

export function mapModelUsageRows(
  rows: Array<{
    model: string;
    totalTokens: number | string;
    costYuan: string | number;
    priced: boolean;
  }>,
): Array<{ model: string; totalTokens: number; costYuan: string; priced: boolean }> {
  return rows.map((row) => ({
    model: row.model,
    totalTokens: Number(row.totalTokens),
    costYuan: row.priced ? formatYuan(row.costYuan) : "0.00",
    priced: Boolean(row.priced),
  }));
}
