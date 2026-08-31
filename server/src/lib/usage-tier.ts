export const USAGE_TIERS = ["light", "standard", "heavy"] as const;
export type UsageTier = (typeof USAGE_TIERS)[number];

/** Daily tokens strictly below this are 轻度. */
export const LIGHT_DAILY_TOKEN_LIMIT = 3_000_000;
/** Daily tokens strictly above this are 重度. */
export const HEAVY_DAILY_TOKEN_LIMIT = 50_000_000;

const TIER_RANK: Record<UsageTier, number> = {
  light: 0,
  standard: 1,
  heavy: 2,
};

/**
 * Classify observed usage from a single-day token total.
 * No usage (new registration, or no counted day) is 重度 — they start on an
 * exclusive Key and step down if later windows stay small.
 */
export function classifyUsageTier(dailyTokens: number | null | undefined): UsageTier {
  if (dailyTokens == null || !Number.isFinite(dailyTokens) || dailyTokens <= 0) {
    return "heavy";
  }
  if (dailyTokens < LIGHT_DAILY_TOKEN_LIMIT) return "light";
  if (dailyTokens > HEAVY_DAILY_TOKEN_LIMIT) return "heavy";
  return "standard";
}

/**
 * Move at most one rung toward the observed tier.
 * New users start 重度; a quiet first week becomes 标准 then 轻度, never jumps
 * 重度 → 轻度 in one step.
 */
export function stepUsageTier(current: UsageTier, observed: UsageTier): UsageTier {
  const delta = TIER_RANK[observed] - TIER_RANK[current];
  if (delta === 0) return current;
  const nextRank = TIER_RANK[current] + Math.sign(delta);
  return USAGE_TIERS[nextRank] ?? current;
}

/** Stored tier after applying one step toward the latest 7-day peak. */
export function effectiveUsageTier(
  stored: UsageTier,
  peakTokens: number | null | undefined,
): UsageTier {
  return stepUsageTier(stored, classifyUsageTier(peakTokens));
}

/**
 * Classify a user from recent daily totals. Uses the peak day in the window.
 * An empty window (new user) is 重度.
 */
export function classifyUsageTierFromDays(dailyTotals: readonly number[]): UsageTier {
  if (dailyTotals.length === 0) return classifyUsageTier(null);
  return classifyUsageTier(Math.max(...dailyTotals));
}
