import { enumerateDays } from "./quota-time.js";

export type UsageCounts = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
  errorCount: number;
};

export type DailyUsage = UsageCounts & {
  day: string;
  successRate: number | null;
};

export type UsageBreakdown = {
  key: string;
  totalTokens: number;
  requestCount: number;
};

function successRate(requestCount: number, errorCount: number): number | null {
  if (requestCount === 0) return null;
  return Math.max(0, requestCount - errorCount) / requestCount;
}

export function fillDailyUsage(
  from: string,
  to: string,
  rows: Array<{ day: string } & UsageCounts>,
): DailyUsage[] {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  return enumerateDays(from, to).map((day) => {
    const row = byDay.get(day);
    const counts: UsageCounts = row
      ? {
        promptTokens: Number(row.promptTokens) || 0,
        completionTokens: Number(row.completionTokens) || 0,
        totalTokens: Number(row.totalTokens) || 0,
        requestCount: Number(row.requestCount) || 0,
        errorCount: Number(row.errorCount) || 0,
      }
      : {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        requestCount: 0,
        errorCount: 0,
      };
    return { day, ...counts, successRate: successRate(counts.requestCount, counts.errorCount) };
  });
}

export function summarizeDailyUsage(daily: DailyUsage[]): UsageCounts & { successRate: number | null } {
  const counts = daily.reduce<UsageCounts>(
    (total, row) => ({
      promptTokens: total.promptTokens + row.promptTokens,
      completionTokens: total.completionTokens + row.completionTokens,
      totalTokens: total.totalTokens + row.totalTokens,
      requestCount: total.requestCount + row.requestCount,
      errorCount: total.errorCount + row.errorCount,
    }),
    { promptTokens: 0, completionTokens: 0, totalTokens: 0, requestCount: 0, errorCount: 0 },
  );
  return { ...counts, successRate: successRate(counts.requestCount, counts.errorCount) };
}

export function appendOtherBucket(
  top: UsageBreakdown[],
  totals: { totalTokens: number; requestCount: number },
): UsageBreakdown[] {
  const shown = top.reduce(
    (sum, row) => ({
      totalTokens: sum.totalTokens + row.totalTokens,
      requestCount: sum.requestCount + row.requestCount,
    }),
    { totalTokens: 0, requestCount: 0 },
  );
  const other = {
    key: "other",
    totalTokens: Math.max(0, totals.totalTokens - shown.totalTokens),
    requestCount: Math.max(0, totals.requestCount - shown.requestCount),
  };
  return other.totalTokens > 0 || other.requestCount > 0 ? [...top, other] : top;
}
