export const USAGE_TIERS = ["light", "standard", "heavy"] as const;
export type UsageTier = (typeof USAGE_TIERS)[number];

/** Daily tokens strictly below this are 轻度. */
export const LIGHT_DAILY_TOKEN_LIMIT = 3_000_000;
/** Daily tokens strictly above this are 重度. */
export const HEAVY_DAILY_TOKEN_LIMIT = 50_000_000;

/**
 * Classify a user from a single-day token total.
 * No usage (new registration, or no counted day) is 标准.
 */
export function classifyUsageTier(dailyTokens: number | null | undefined): UsageTier {
  if (dailyTokens == null || !Number.isFinite(dailyTokens) || dailyTokens <= 0) {
    return "standard";
  }
  if (dailyTokens < LIGHT_DAILY_TOKEN_LIMIT) return "light";
  if (dailyTokens > HEAVY_DAILY_TOKEN_LIMIT) return "heavy";
  return "standard";
}

/**
 * Classify a user from recent daily totals. Uses the peak day in the window.
 * An empty window (new user) is 标准.
 */
export function classifyUsageTierFromDays(dailyTotals: readonly number[]): UsageTier {
  if (dailyTotals.length === 0) return "standard";
  return classifyUsageTier(Math.max(...dailyTotals));
}
