import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyUsageTier,
  classifyUsageTierFromDays,
  effectiveUsageTier,
  isUsageTierProtected,
  USAGE_TIER_PROTECTION_MS,
} from "../src/lib/usage-tier.js";

const REGISTERED = new Date("2026-08-01T00:00:00.000Z");

function at(iso: string): Date {
  return new Date(iso);
}

test("unused accounts classify as light", () => {
  assert.equal(classifyUsageTier(null), "light");
  assert.equal(classifyUsageTier(undefined), "light");
  assert.equal(classifyUsageTier(0), "light");
  assert.equal(classifyUsageTierFromDays([]), "light");
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

test("after protection, the 7-day peak classifies directly", () => {
  const graduated = at("2026-08-08T00:00:00.000Z");
  assert.equal(effectiveUsageTier(null, REGISTERED, graduated), "light");
  assert.equal(effectiveUsageTier(0, REGISTERED, graduated), "light");
  assert.equal(effectiveUsageTier(699_847, REGISTERED, graduated), "light");
  assert.equal(effectiveUsageTier(12_000_000, REGISTERED, graduated), "standard");
  assert.equal(effectiveUsageTier(80_000_000, REGISTERED, graduated), "heavy");
});

test("daily usage below 3 million is light", () => {
  assert.equal(classifyUsageTier(1), "light");
  assert.equal(classifyUsageTier(2_999_999), "light");
});

test("daily usage from 3 million through 50 million is standard", () => {
  assert.equal(classifyUsageTier(3_000_000), "standard");
  assert.equal(classifyUsageTier(12_000_000), "standard");
  assert.equal(classifyUsageTier(50_000_000), "standard");
});

test("daily usage above 50 million is heavy", () => {
  assert.equal(classifyUsageTier(50_000_001), "heavy");
  assert.equal(classifyUsageTier(248_000_000), "heavy");
});

test("recent-window classification uses the peak day", () => {
  assert.equal(classifyUsageTierFromDays([800_000, 12_000_000]), "standard");
  assert.equal(classifyUsageTierFromDays([800_000, 80_000_000]), "heavy");
  assert.equal(classifyUsageTierFromDays([200_000, 900_000]), "light");
});
