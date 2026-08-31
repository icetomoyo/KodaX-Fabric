import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyUsageTier,
  classifyUsageTierFromDays,
} from "../src/lib/usage-tier.js";

test("new or unused users default to standard", () => {
  assert.equal(classifyUsageTier(null), "standard");
  assert.equal(classifyUsageTier(undefined), "standard");
  assert.equal(classifyUsageTier(0), "standard");
  assert.equal(classifyUsageTierFromDays([]), "standard");
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
