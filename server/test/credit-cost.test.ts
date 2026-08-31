import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const {
  computeRequestCredits,
  defaultCreditRateFor,
  intervalPeakMultiplier,
  isPeakHour,
  peakOverlapMs,
  resolveEffectiveCreditRate,
} = await import("../src/lib/relay/credit-cost.js");

const glm53 = {
  promptCreditsPer10k: "6.9",
  cacheHitCreditsPer10k: "1.7",
  completionCreditsPer10k: "24",
};

test("isPeakHour is Mon-Fri 14:00-18:00 UTC+8 exclusive of 18:00", () => {
  // Friday 17:59 UTC+8 = Friday 09:59 UTC
  assert.equal(isPeakHour(new Date("2026-08-28T09:59:00.000Z")), true);
  // Friday 18:00 UTC+8 = Friday 10:00 UTC
  assert.equal(isPeakHour(new Date("2026-08-28T10:00:00.000Z")), false);
  // Friday 14:00 UTC+8 = Friday 06:00 UTC
  assert.equal(isPeakHour(new Date("2026-08-28T06:00:00.000Z")), true);
  // Friday 13:59 UTC+8 = Friday 05:59 UTC
  assert.equal(isPeakHour(new Date("2026-08-28T05:59:00.000Z")), false);
});

test("isPeakHour is off-peak on weekends even during 14:00-18:00 UTC+8", () => {
  // Saturday 15:00 UTC+8 = Saturday 07:00 UTC
  assert.equal(isPeakHour(new Date("2026-08-29T07:00:00.000Z")), false);
  // Sunday 16:00 UTC+8 = Sunday 08:00 UTC
  assert.equal(isPeakHour(new Date("2026-08-30T08:00:00.000Z")), false);
});

test("computeRequestCredits returns 0 when rate is null", () => {
  const peak = new Date("2026-08-28T06:00:00.000Z");
  assert.equal(
    computeRequestCredits(
      { promptTokens: 10_000, completionTokens: 10_000, cacheReadTokens: 0 },
      null,
      peak,
    ),
    0,
  );
});

test("computeRequestCredits clamps cache-read tokens to prompt tokens", () => {
  const peak = new Date("2026-08-28T06:00:00.000Z");
  // prompt=100, cacheRead=250 → cache=100, uncached=0
  // (100 * 1.7) / 10000 * 1.0 = 0.017
  assert.equal(
    computeRequestCredits(
      { promptTokens: 100, completionTokens: 0, cacheReadTokens: 250 },
      glm53,
      peak,
    ),
    0.017,
  );
});

test("computeRequestCredits applies GLM-5.3 rates and peak / off-peak multipliers", () => {
  const peak = new Date("2026-08-28T06:00:00.000Z");
  const offPeak = new Date("2026-08-28T10:00:00.000Z");
  const usage = { promptTokens: 10_000, completionTokens: 10_000, cacheReadTokens: 0 };
  // ((10000 * 6.9 + 10000 * 24) / 10000) = 30.9
  assert.equal(computeRequestCredits(usage, glm53, peak), 30.9);
  assert.equal(computeRequestCredits(usage, glm53, offPeak), 15.45);
});

test("intervalPeakMultiplier is 1 inside weekday 14:00-18:00 UTC+8 and 0.5 outside", () => {
  const peak = new Date("2026-08-28T06:00:00.000Z");
  const offPeak = new Date("2026-08-28T10:00:00.000Z");
  assert.equal(intervalPeakMultiplier(peak, peak), 1);
  assert.equal(intervalPeakMultiplier(offPeak, offPeak), 0.5);
});

test("intervalPeakMultiplier splits a request that crosses 14:00 UTC+8", () => {
  // Friday 13:50–14:10 UTC+8 = 20 min, half in peak.
  const start = new Date("2026-08-28T05:50:00.000Z");
  const end = new Date("2026-08-28T06:10:00.000Z");
  assert.equal(peakOverlapMs(start, end), 10 * 60_000);
  assert.equal(intervalPeakMultiplier(start, end), 0.75);
});

test("intervalPeakMultiplier ignores seconds and counts whole minutes", () => {
  const start = new Date("2026-08-28T05:50:45.000Z");
  const end = new Date("2026-08-28T06:10:20.000Z");
  assert.equal(peakOverlapMs(start, end), 10 * 60_000);
  assert.equal(intervalPeakMultiplier(start, end), 0.75);
});

test("intervalPeakMultiplier splits a request that crosses 18:00 UTC+8", () => {
  // Friday 17:50–18:10 UTC+8 = 20 min, half in peak.
  const start = new Date("2026-08-28T09:50:00.000Z");
  const end = new Date("2026-08-28T10:10:00.000Z");
  assert.equal(peakOverlapMs(start, end), 10 * 60_000);
  assert.equal(intervalPeakMultiplier(start, end), 0.75);
});

test("intervalPeakMultiplier ignores weekend hours even during 14:00-18:00 UTC+8", () => {
  const start = new Date("2026-08-29T06:00:00.000Z");
  const end = new Date("2026-08-29T10:00:00.000Z");
  assert.equal(peakOverlapMs(start, end), 0);
  assert.equal(intervalPeakMultiplier(start, end), 0.5);
});

test("computeRequestCredits bills input at start and output across the peak window", () => {
  const start = new Date("2026-08-28T05:50:00.000Z");
  const end = new Date("2026-08-28T06:10:00.000Z");
  const usage = { promptTokens: 10_000, completionTokens: 10_000, cacheReadTokens: 0 };
  // input 6.9 × 0.5 + output 24 × 0.75 = 3.45 + 18 = 21.45
  assert.equal(computeRequestCredits(usage, glm53, start, end), 21.45);
});

test("computeRequestCredits bills uncached and cache-hit tokens separately", () => {
  const peak = new Date("2026-08-28T06:00:00.000Z");
  // uncached=2000, cache=8000, completion=1000
  // (2000 * 6.9 + 8000 * 1.7 + 1000 * 24) / 10000 = 5.14
  assert.equal(
    computeRequestCredits(
      { promptTokens: 10_000, completionTokens: 1_000, cacheReadTokens: 8_000 },
      glm53,
      peak,
    ),
    5.14,
  );
});

const glmFlash = {
  promptCreditsPer10k: "2.3",
  cacheHitCreditsPer10k: "0.56",
  completionCreditsPer10k: "8",
};

test("defaultCreditRateFor matches Flash GLM names case-insensitively", () => {
  assert.deepEqual(defaultCreditRateFor("glm-5.3-flash"), glmFlash);
  assert.deepEqual(defaultCreditRateFor("GLM-5.3-FLASH"), glmFlash);
  assert.deepEqual(defaultCreditRateFor("GLM-4.6-Flash"), glmFlash);
});

test("defaultCreditRateFor uses GLM-5.3 rates for other glm-prefixed models", () => {
  assert.deepEqual(defaultCreditRateFor("glm-5.3"), glm53);
  assert.deepEqual(defaultCreditRateFor("GLM-4.6"), glm53);
  assert.deepEqual(defaultCreditRateFor("glm-4.5-air"), glm53);
});

test("defaultCreditRateFor returns null for non-GLM models", () => {
  assert.equal(defaultCreditRateFor("gpt-4o"), null);
  assert.equal(defaultCreditRateFor("claude-sonnet-4"), null);
  assert.equal(defaultCreditRateFor("qwen-flash"), null);
});

test("resolveEffectiveCreditRate prefers a complete custom DB rate over the default", () => {
  const custom = {
    promptCreditsPer10k: "1",
    cacheHitCreditsPer10k: "2",
    completionCreditsPer10k: "3",
  };
  assert.deepEqual(resolveEffectiveCreditRate("glm-5.3", custom), {
    ...custom,
    source: "custom",
  });
  assert.deepEqual(resolveEffectiveCreditRate("glm-5.3-flash", custom), {
    ...custom,
    source: "custom",
  });
});

test("resolveEffectiveCreditRate falls back to the default when DB columns are incomplete", () => {
  assert.deepEqual(
    resolveEffectiveCreditRate("glm-5.3", {
      promptCreditsPer10k: "1",
      cacheHitCreditsPer10k: null,
      completionCreditsPer10k: "3",
    }),
    { ...glm53, source: "default" },
  );
  assert.deepEqual(resolveEffectiveCreditRate("glm-5.3", null), {
    ...glm53,
    source: "default",
  });
  assert.deepEqual(
    resolveEffectiveCreditRate("gpt-4o", {
      promptCreditsPer10k: "1",
      cacheHitCreditsPer10k: null,
      completionCreditsPer10k: null,
    }),
    null,
  );
});
