import assert from "node:assert/strict";
import test from "node:test";
import {
  avgTokensPerRequest,
  cacheHitRate,
  peakHour,
  percentChange,
  splitHourlyTokens,
  tokenComposition,
} from "../src/lib/workbench-today.js";

test("percent change is the delta ratio and stays blank when yesterday is zero", () => {
  assert.equal(percentChange(118, 100), 0.18);
  assert.equal(percentChange(96, 100), -0.04);
  assert.equal(percentChange(100, 100), 0);
  assert.equal(percentChange(10, 0), null);
  assert.equal(percentChange(0, 0), null);
});

test("cache hit rate is cache reads over prompt tokens", () => {
  assert.equal(cacheHitRate(70, 100), 0.7);
  assert.equal(cacheHitRate(0, 100), 0);
  assert.equal(cacheHitRate(0, 0), null);
  assert.equal(cacheHitRate(250, 100), 1);
});

test("average tokens per request uses the request count as the denominator", () => {
  assert.equal(avgTokensPerRequest(147_000, 10), 14_700);
  assert.equal(avgTokensPerRequest(10, 0), null);
});

test("peak hour is the busiest hourly bucket with usage", () => {
  const peak = peakHour([
    { day: "2026-09-14 09:00", totalTokens: 10 },
    { day: "2026-09-14 14:00", totalTokens: 90 },
    { day: "2026-09-14 15:00", totalTokens: 20 },
    { day: "2026-09-14 16:00", totalTokens: 0 },
  ]);
  assert.equal(peak?.hour, "14:00");
  assert.equal(peak?.totalTokens, 90);
  assert.equal(peakHour([{ day: "2026-09-14 00:00", totalTokens: 0 }]), null);
});

test("token composition treats cache reads as part of prompt, never more than prompt", () => {
  assert.deepEqual(
    tokenComposition({ promptTokens: 100, cacheReadTokens: 70, completionTokens: 40 }),
    { uncachedPrompt: 30, cacheRead: 70, completion: 40 },
  );
  assert.deepEqual(
    tokenComposition({ promptTokens: 100, cacheReadTokens: 250, completionTokens: 0 }),
    { uncachedPrompt: 0, cacheRead: 100, completion: 0 },
  );
});

test("hourly token split matches the composition rule", () => {
  assert.deepEqual(
    splitHourlyTokens({ promptTokens: 50, cacheReadTokens: 20, completionTokens: 10 }),
    { uncachedPrompt: 30, cacheRead: 20, completion: 10 },
  );
});
