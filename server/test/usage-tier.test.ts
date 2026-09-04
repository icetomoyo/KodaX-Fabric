import assert from "node:assert/strict";
import test from "node:test";
import {
  averageDailyTokensFromWindow,
  classifyUsageTier,
  classifyUsageTierFromDays,
  effectiveUsageTier,
  HEAVY_AVG_DAILY_TOKEN_LIMIT,
  isUsageTierProtected,
  usageTierForRequest,
  USAGE_TIER_PROTECTION_MS,
  USAGE_TIER_WINDOW_DAYS,
} from "../src/lib/usage-tier.js";

const REGISTERED = new Date("2026-08-01T00:00:00.000Z");

function at(iso: string): Date {
  return new Date(iso);
}

test("unused accounts classify as idle", () => {
  assert.equal(classifyUsageTier(null), "idle");
  assert.equal(classifyUsageTier(undefined), "idle");
  assert.equal(classifyUsageTier(0), "idle");
  assert.equal(classifyUsageTier(0, 0), "idle");
  assert.equal(classifyUsageTierFromDays([]), "idle");
});

test("zero tokens with TokenHub calls stay standard", () => {
  assert.equal(classifyUsageTier(0, 1), "standard");
  assert.equal(classifyUsageTier(0, 36), "standard");
  assert.equal(classifyUsageTier(null, 12), "standard");
});

test("a live request promotes idle to standard", () => {
  assert.equal(usageTierForRequest("idle"), "standard");
  assert.equal(usageTierForRequest("standard"), "standard");
  assert.equal(usageTierForRequest("heavy"), "heavy");
});

test("heavy threshold is a 7-day daily average of 30 million", () => {
  assert.equal(USAGE_TIER_WINDOW_DAYS, 7);
  assert.equal(HEAVY_AVG_DAILY_TOKEN_LIMIT, 30_000_000);
  assert.equal(averageDailyTokensFromWindow(210_000_000), 30_000_000);
  assert.equal(averageDailyTokensFromWindow(12_000_000) < 30_000_000, true);
});

test("registration protection lasts 7 × 24 hours", () => {
  assert.equal(USAGE_TIER_PROTECTION_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(isUsageTierProtected(REGISTERED, at("2026-08-07T23:59:59.999Z")), true);
  assert.equal(isUsageTierProtected(REGISTERED, at("2026-08-08T00:00:00.000Z")), false);
  assert.equal(
    effectiveUsageTier(699_847, REGISTERED, at("2026-08-07T23:59:59.999Z")),
    "heavy",
  );
  assert.equal(effectiveUsageTier(80_000_000, REGISTERED, at("2026-08-04T12:00:00.000Z")), "heavy");
  assert.equal(effectiveUsageTier(0, REGISTERED, at("2026-08-04T12:00:00.000Z")), "heavy");
  assert.equal(effectiveUsageTier(null, REGISTERED, at("2026-08-04T12:00:00.000Z")), "heavy");
});

test("after protection, the 7-day average classifies directly", () => {
  const graduated = at("2026-08-08T00:00:00.000Z");
  assert.equal(effectiveUsageTier(null, REGISTERED, graduated), "idle");
  assert.equal(effectiveUsageTier(0, REGISTERED, graduated), "idle");
  assert.equal(effectiveUsageTier(0, REGISTERED, graduated, 0), "idle");
  assert.equal(effectiveUsageTier(0, REGISTERED, graduated, 36), "standard");
  assert.equal(effectiveUsageTier(699_847, REGISTERED, graduated), "standard");
  assert.equal(effectiveUsageTier(12_000_000, REGISTERED, graduated), "standard");
  assert.equal(effectiveUsageTier(29_999_999, REGISTERED, graduated), "standard");
  assert.equal(effectiveUsageTier(30_000_000, REGISTERED, graduated), "heavy");
  assert.equal(effectiveUsageTier(80_000_000, REGISTERED, graduated), "heavy");
});

test("7-day average below 30 million is standard", () => {
  assert.equal(classifyUsageTier(1), "standard");
  assert.equal(classifyUsageTier(2_999_999), "standard");
  assert.equal(classifyUsageTier(3_000_000), "standard");
  assert.equal(classifyUsageTier(12_000_000), "standard");
  assert.equal(classifyUsageTier(29_999_999), "standard");
});

test("7-day average at or above 30 million is heavy", () => {
  assert.equal(classifyUsageTier(30_000_000), "heavy");
  assert.equal(classifyUsageTier(30_000_001), "heavy");
  assert.equal(classifyUsageTier(248_000_000), "heavy");
});

test("recent-window classification uses the 7-day average, missing days as 0", () => {
  assert.equal(classifyUsageTierFromDays([800_000, 12_000_000]), "standard");
  assert.equal(classifyUsageTierFromDays([800_000, 80_000_000]), "standard");
  assert.equal(classifyUsageTierFromDays([200_000, 900_000]), "standard");
  assert.equal(classifyUsageTierFromDays([210_000_000]), "heavy");
  assert.equal(classifyUsageTierFromDays([30_000_000, 30_000_000, 30_000_000, 30_000_000, 30_000_000, 30_000_000, 30_000_000]), "heavy");
});
