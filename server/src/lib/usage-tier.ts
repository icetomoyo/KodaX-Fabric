export const USAGE_TIERS = ["idle", "standard", "heavy"] as const;
export type UsageTier = (typeof USAGE_TIERS)[number];

/** Stored default for a new account (also the 7×24h protection tier). */
export const DEFAULT_USAGE_TIER: UsageTier = "heavy";

/** Calendar days in the usage-tier window (today and the 6 days before). */
export const USAGE_TIER_WINDOW_DAYS = 7;

/** 7-day average daily tokens at or above this are 重度. */
export const HEAVY_AVG_DAILY_TOKEN_LIMIT = 30_000_000;

/** New accounts stay 重度 for this long after `employees.createdAt`. */
export const USAGE_TIER_PROTECTION_MS = 7 * 24 * 60 * 60 * 1000;

function asNonNegative(value: number | null | undefined): number {
  return value == null || !Number.isFinite(value) || value < 0 ? 0 : value;
}

/** Spread a window token total across the 7-day classification window. */
export function averageDailyTokensFromWindow(totalTokens: number | null | undefined): number {
  return asNonNegative(totalTokens) / USAGE_TIER_WINDOW_DAYS;
}

/**
 * Classify observed usage from the 7-day daily average and call count.
 * No TokenHub calls (0 tokens and 0 requests) is 闲置 — they hold no channel Key.
 * Failed calls with 0 tokens still count as 标准 so the Key stays available.
 */
export function classifyUsageTier(
  averageDailyTokens: number | null | undefined,
  requestCount?: number | null,
): UsageTier {
  const tokens = asNonNegative(averageDailyTokens);
  const requests = asNonNegative(requestCount);
  if (tokens <= 0 && requests <= 0) return "idle";
  if (tokens >= HEAVY_AVG_DAILY_TOKEN_LIMIT) return "heavy";
  return "standard";
}

/** True until `createdAt + 7×24h` (exclusive of the exact end instant). */
export function isUsageTierProtected(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() < USAGE_TIER_PROTECTION_MS;
}

/**
 * Live usage tier: 7×24h after registration is always 重度.
 * After that, classify from the 7-day daily average and call count (may jump).
 */
export function effectiveUsageTier(
  averageDailyTokens: number | null | undefined,
  createdAt: Date,
  now: Date = new Date(),
  requestCount?: number | null,
): UsageTier {
  if (isUsageTierProtected(createdAt, now)) return "heavy";
  return classifyUsageTier(averageDailyTokens, requestCount);
}

/**
 * Idle accounts hold no Key. A live request promotes them to 标准 so they
 * can bind a department-shared Key immediately.
 */
export function usageTierForRequest(tier: UsageTier): UsageTier {
  return tier === "idle" ? "standard" : tier;
}

/**
 * Classify a user from recent daily totals. Missing days in the 7-day window
 * count as 0. An empty window (no counted day) is 闲置.
 */
export function classifyUsageTierFromDays(dailyTotals: readonly number[]): UsageTier {
  if (dailyTotals.length === 0) return classifyUsageTier(null);
  const total = dailyTotals.reduce((sum, value) => sum + asNonNegative(value), 0);
  return classifyUsageTier(averageDailyTokensFromWindow(total));
}
