/**
 * Per-10k-token credit coefficients stored as numeric strings (Drizzle).
 *
 * Quota decisions only need "used >= limit" — Number (IEEE-754) is enough at
 * typical coding-plan magnitudes (tens of thousands of credits). We do not
 * use big-decimal here; rounding error is accepted for exhaustion checks.
 */
export interface ModelCreditRate {
  promptCreditsPer10k: string;
  cacheHitCreditsPer10k: string;
  completionCreditsPer10k: string;
}

export type CreditRateSource = "custom" | "default";

export type EffectiveCreditRate = ModelCreditRate & {
  source: CreditRateSource;
};

export type StoredCreditRate = {
  promptCreditsPer10k: string | null;
  cacheHitCreditsPer10k: string | null;
  completionCreditsPer10k: string | null;
};

/** GLM Flash row from the official Zhipu coding-plan table. */
const GLM_FLASH_CREDIT_RATE: ModelCreditRate = {
  promptCreditsPer10k: "2.3",
  cacheHitCreditsPer10k: "0.56",
  completionCreditsPer10k: "8",
};

/** GLM-5.3 row; Zhipu bills historical GLM models at these rates. */
const GLM_DEFAULT_CREDIT_RATE: ModelCreditRate = {
  promptCreditsPer10k: "6.9",
  cacheHitCreditsPer10k: "1.7",
  completionCreditsPer10k: "24",
};

/**
 * Built-in Zhipu coding-plan credit coefficients.
 *
 * Official table: https://docs.bigmodel.cn/cn/coding-plan/team
 * ("积分抵扣计算方式"). Names containing `flash` under the GLM family use
 * the Flash row; remaining models that start with `glm` use the GLM-5.3
 * row because Zhipu bills historical models at GLM-5.3 rates. Non-GLM
 * models have no built-in rate. Edit this table when official rates change.
 */
export function defaultCreditRateFor(clientModel: string): ModelCreditRate | null {
  const name = clientModel.toLowerCase();
  if (name.startsWith("glm") && name.includes("flash")) {
    return GLM_FLASH_CREDIT_RATE;
  }
  if (name.startsWith("glm")) {
    return GLM_DEFAULT_CREDIT_RATE;
  }
  return null;
}

function isCompleteCreditRate(row: StoredCreditRate): row is ModelCreditRate {
  return (
    row.promptCreditsPer10k != null
    && row.cacheHitCreditsPer10k != null
    && row.completionCreditsPer10k != null
  );
}

/**
 * Admin / metering resolver: a complete custom DB row wins; otherwise the
 * built-in default for that model name; otherwise null.
 */
export function resolveEffectiveCreditRate(
  clientModel: string,
  stored: StoredCreditRate | null,
): EffectiveCreditRate | null {
  if (stored && isCompleteCreditRate(stored)) {
    return {
      promptCreditsPer10k: stored.promptCreditsPer10k,
      cacheHitCreditsPer10k: stored.cacheHitCreditsPer10k,
      completionCreditsPer10k: stored.completionCreditsPer10k,
      source: "custom",
    };
  }
  const fallback = defaultCreditRateFor(clientModel);
  if (!fallback) return null;
  return { ...fallback, source: "default" };
}

const UTC_PLUS_8_MS = 8 * 60 * 60 * 1_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const PEAK_START_HOUR = 14;
const PEAK_END_HOUR = 18;
const PEAK_MULTIPLIER = 1;
const OFF_PEAK_MULTIPLIER = 0.5;

export type RequestCreditUsage = {
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
};

function toSafeTokens(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function toRate(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Peak hours are Mon–Fri 14:00–18:00 in fixed UTC+8 (inclusive 14:00,
 * exclusive 18:00). Independent of `QUOTA_TIMEZONE`.
 */
export function isPeakHour(at: Date): boolean {
  const utc8 = new Date(at.getTime() + UTC_PLUS_8_MS);
  const weekday = utc8.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  const hour = utc8.getUTCHours();
  return hour >= PEAK_START_HOUR && hour < PEAK_END_HOUR;
}

export function peakMultiplierAt(at: Date): number {
  return isPeakHour(at) ? PEAK_MULTIPLIER : OFF_PEAK_MULTIPLIER;
}

function utc8DayStartMs(atMs: number): number {
  const utc8 = new Date(atMs + UTC_PLUS_8_MS);
  return Date.UTC(utc8.getUTCFullYear(), utc8.getUTCMonth(), utc8.getUTCDate()) - UTC_PLUS_8_MS;
}

function floorToMinute(ms: number): number {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS;
}

/** Whole minutes of `[start, end)` that fall in weekday 14:00–18:00 UTC+8. Seconds are ignored. */
export function peakOverlapMs(start: Date, end: Date): number {
  const first = floorToMinute(Math.min(start.getTime(), end.getTime()));
  const last = floorToMinute(Math.max(start.getTime(), end.getTime()));
  if (last <= first) return 0;

  let peakMs = 0;
  let dayStart = utc8DayStartMs(first);
  let guard = 0;
  while (dayStart < last && guard < 40) {
    guard += 1;
    const weekday = new Date(dayStart + UTC_PLUS_8_MS).getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      const windowStart = dayStart + PEAK_START_HOUR * HOUR_MS;
      const windowEnd = dayStart + PEAK_END_HOUR * HOUR_MS;
      const overlapStart = Math.max(first, windowStart);
      const overlapEnd = Math.min(last, windowEnd);
      if (overlapEnd > overlapStart) peakMs += overlapEnd - overlapStart;
    }
    dayStart += DAY_MS;
  }
  return peakMs;
}

/**
 * Time-weighted multiplier over `[start, end]`: peak ×1, off-peak ×0.5.
 * A zero-length interval uses the instant at `start`.
 */
export function intervalPeakMultiplier(start: Date, end: Date): number {
  const first = floorToMinute(Math.min(start.getTime(), end.getTime()));
  const last = floorToMinute(Math.max(start.getTime(), end.getTime()));
  const duration = last - first;
  if (duration === 0) return peakMultiplierAt(start);
  const fraction = Math.min(1, Math.max(0, peakOverlapMs(start, end) / duration));
  return OFF_PEAK_MULTIPLIER + (PEAK_MULTIPLIER - OFF_PEAK_MULTIPLIER) * fraction;
}

/**
 * Zhipu coding-plan credits:
 * ((uncached prompt × Input + cache hit × Cached Input) / 10000) × start multiplier
 * + (output × Output / 10000) × time-weighted multiplier over `[startedAt, endedAt]`.
 * Prefill is billed at the request start; streamed output follows wall-clock
 * overlap with Mon–Fri 14:00–18:00 UTC+8. Omit `endedAt` to bill the whole
 * request at `startedAt`.
 */
export function computeRequestCredits(
  usage: RequestCreditUsage,
  rate: ModelCreditRate | null,
  startedAt: Date,
  endedAt: Date = startedAt,
): number {
  if (!rate) return 0;
  const prompt = toSafeTokens(usage.promptTokens);
  const completion = toSafeTokens(usage.completionTokens);
  const cacheRead = Math.min(prompt, toSafeTokens(usage.cacheReadTokens));
  const uncached = prompt - cacheRead;
  const inputCredits =
    (uncached * toRate(rate.promptCreditsPer10k)
      + cacheRead * toRate(rate.cacheHitCreditsPer10k))
    / 10_000
    * peakMultiplierAt(startedAt);
  const outputCredits =
    (completion * toRate(rate.completionCreditsPer10k))
    / 10_000
    * intervalPeakMultiplier(startedAt, endedAt);
  const credits = inputCredits + outputCredits;
  if (!Number.isFinite(credits) || credits <= 0) return 0;
  return Math.round(credits * 10_000) / 10_000;
}

/** Metering lookup uses the built-in coding-plan table. */
export async function getModelCreditRate(clientModel: string): Promise<ModelCreditRate | null> {
  return defaultCreditRateFor(clientModel);
}
