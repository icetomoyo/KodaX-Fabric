export const USAGE_TIERS = ["light", "standard", "heavy"] as const;
export type UsageTier = (typeof USAGE_TIERS)[number];

/** Stored default for a new account (also the 7×24h protection tier). */
export const DEFAULT_USAGE_TIER: UsageTier = "heavy";

/** Daily tokens strictly below this are 轻度. */
export const LIGHT_DAILY_TOKEN_LIMIT = 3_000_000;
/** Daily tokens strictly above this are 重度. */
export const HEAVY_DAILY_TOKEN_LIMIT = 50_000_000;

/** New accounts stay 重度 for this long after `employees.createdAt`. */
export const USAGE_TIER_PROTECTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Classify observed usage from a single-day token total.
 * No usage (0 / missing window) is 轻度 — exclusive Keys are only for the
 * 7×24h protection window or a peak above the heavy threshold.
 */
export function classifyUsageTier(dailyTokens: number | null | undefined): UsageTier {
  const tokens =
    dailyTokens == null || !Number.isFinite(dailyTokens) || dailyTokens < 0 ? 0 : dailyTokens;
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
 * After that, classify from the latest 7-day peak (may jump).
 */
export function effectiveUsageTier(
  peakTokens: number | null | undefined,
  createdAt: Date,
  now: Date = new Date(),
): UsageTier {
  if (isUsageTierProtected(createdAt, now)) return "heavy";
  return classifyUsageTier(peakTokens);
}

/**
 * Classify a user from recent daily totals. Uses the peak day in the window.
 * An empty window (no counted day) is 轻度.
 */
export function classifyUsageTierFromDays(dailyTotals: readonly number[]): UsageTier {
  if (dailyTotals.length === 0) return classifyUsageTier(null);
  return classifyUsageTier(Math.max(...dailyTotals));
}
