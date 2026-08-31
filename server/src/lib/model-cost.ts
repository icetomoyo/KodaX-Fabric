import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { requestAudits } from "../db/schema/index.js";
import { addCalendarDays, enumerateDays, formatUtcDate, quotaDayAt } from "./quota-time.js";

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
    })
    .from(requestAudits)
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
    })
    .from(requestAudits)
    .where(and(eq(requestAudits.teamId, input.teamId), createdAtWindow(input.start, input.endExclusive)))
    .groupBy(requestAudits.clientModel)
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
  }>,
): Array<{ day: string; totalTokens: number; requestCount: number }> {
  const byDay = new Map(rows.map((row) => [normalizeDay(row.day), row]));
  return enumerateDays(from, to).map((day) => {
    const row = byDay.get(day);
    return {
      day,
      totalTokens: Number(row?.totalTokens ?? 0),
      requestCount: Number(row?.requestCount ?? 0),
    };
  });
}

export function mapModelUsageRows(
  rows: Array<{
    model: string;
    totalTokens: number | string;
  }>,
): Array<{ model: string; totalTokens: number }> {
  return rows.map((row) => ({
    model: row.model,
    totalTokens: Number(row.totalTokens),
  }));
}
