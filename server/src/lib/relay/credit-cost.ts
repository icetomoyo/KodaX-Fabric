import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { modelPrices } from "../../db/schema/index.js";

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
 * models have no built-in rate. When official rates change, override the
 * three columns on the model-prices admin page first; edit this table
 * only if the built-in default itself is wrong.
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
const PEAK_START_HOUR = 14;
const PEAK_END_HOUR = 18;

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

/**
 * Zhipu coding-plan credits:
 * ((uncached prompt × Input + cache hit × Cached Input + output × Output) / 10000)
 * × (1.0 peak / 0.5 off-peak).
 * Cache hits are clamped to prompt tokens before the uncached remainder is billed.
 */
export function computeRequestCredits(
  usage: RequestCreditUsage,
  rate: ModelCreditRate | null,
  at: Date,
): number {
  if (!rate) return 0;
  const prompt = toSafeTokens(usage.promptTokens);
  const completion = toSafeTokens(usage.completionTokens);
  const cacheRead = Math.min(prompt, toSafeTokens(usage.cacheReadTokens));
  const uncached = prompt - cacheRead;
  const base =
    (uncached * toRate(rate.promptCreditsPer10k)
      + cacheRead * toRate(rate.cacheHitCreditsPer10k)
      + completion * toRate(rate.completionCreditsPer10k))
    / 10_000;
  const credits = base * (isPeakHour(at) ? 1 : 0.5);
  return Number.isFinite(credits) && credits > 0 ? credits : 0;
}

/**
 * Metering lookup: complete custom columns on `model_prices` override the
 * built-in default; otherwise `defaultCreditRateFor`; otherwise null.
 */
export async function getModelCreditRate(clientModel: string): Promise<ModelCreditRate | null> {
  const [row] = await db
    .select({
      promptCreditsPer10k: modelPrices.promptCreditsPer10k,
      cacheHitCreditsPer10k: modelPrices.cacheHitCreditsPer10k,
      completionCreditsPer10k: modelPrices.completionCreditsPer10k,
    })
    .from(modelPrices)
    .where(eq(modelPrices.model, clientModel.slice(0, 128)))
    .limit(1);
  const effective = resolveEffectiveCreditRate(clientModel, row ?? null);
  if (!effective) return null;
  return {
    promptCreditsPer10k: effective.promptCreditsPer10k,
    cacheHitCreditsPer10k: effective.cacheHitCreditsPer10k,
    completionCreditsPer10k: effective.completionCreditsPer10k,
  };
}
