export const USAGE_TIERS = ["idle", "light", "standard", "heavy"] as const;
export type UsageTier = (typeof USAGE_TIERS)[number];

/** Stored default for a new account (also the 7×24h protection tier). */
export const DEFAULT_USAGE_TIER: UsageTier = "heavy";

/** Daily tokens strictly below this are 轻度. */
export const LIGHT_DAILY_TOKEN_LIMIT = 3_000_000;
/** Daily tokens strictly above this are 重度. */
export const HEAVY_DAILY_TOKEN_LIMIT = 50_000_000;

/** New accounts stay 重度 for this long after `employees.createdAt`. */
export const USAGE_TIER_PROTECTION_MS = 7 * 24 * 60 * 60 * 1000;

function asNonNegative(value: number | null | undefined): number {
  return value == null || !Number.isFinite(value) || value < 0 ? 0 : value;
}

/**
 * Classify observed usage from a window peak and call count.
 * No TokenHub calls (0 tokens and 0 requests) is 闲置 — they hold no channel Key.
 * Failed calls with 0 tokens still count as 轻度 so the Key stays available.
 */
export function classifyUsageTier(
  dailyTokens: number | null | undefined,
  requestCount?: number | null,
): UsageTier {
  const tokens = asNonNegative(dailyTokens);
  const requests = asNonNegative(requestCount);
  if (tokens <= 0 && requests <= 0) return "idle";
  if (tokens < LIGHT_DAILY_TOKEN_LIMIT) return "light";
  if (tokens > HEAVY_DAILY_TOKEN_LIMIT) return "heavy";
  return "standard";
}

/** True until `createdAt + 7×24h` (exclusive of the exact end instant). */
export function isUsageTierProtected(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() < USAGE_TIER_PROTECTION_MS;
}

/**
 * Live usage tier: 7×24h after registration is always 重度.
 * After that, classify from the latest 7-day peak and call count (may jump).
 */
export function effectiveUsageTier(
  peakTokens: number | null | undefined,
  createdAt: Date,
  now: Date = new Date(),
  requestCount?: number | null,
): UsageTier {
  if (isUsageTierProtected(createdAt, now)) return "heavy";
  return classifyUsageTier(peakTokens, requestCount);
}

/**
 * Idle accounts hold no Key. A live request promotes them to 轻度 so they
 * can bind an enterprise-shared Key immediately.
 */
export function usageTierForRequest(tier: UsageTier): UsageTier {
  return tier === "idle" ? "light" : tier;
}

/**
 * Classify a user from recent daily totals. Uses the peak day in the window.
 * An empty window (no counted day) is 闲置.
 */
export function classifyUsageTierFromDays(dailyTotals: readonly number[]): UsageTier {
  if (dailyTotals.length === 0) return classifyUsageTier(null);
  return classifyUsageTier(Math.max(...dailyTotals));
}
