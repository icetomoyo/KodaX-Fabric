import assert from "node:assert/strict";
import test from "node:test";
import {
  avgTokensPerRequest,
  cacheHitRate,
  canonicalizeClientModel,
  modelUsageRanks,
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

test("client model ranks fold case and drop names with no token usage", () => {
  assert.equal(canonicalizeClientModel("GLM-5.3"), "glm-5.3");
  assert.equal(canonicalizeClientModel(" glm-5.3-flash "), "glm-5.3-flash");
  assert.equal(canonicalizeClientModel("(invalid)"), "(invalid)");
  assert.deepEqual(
    modelUsageRanks(
      [
        { key: "GLM-5.3", totalTokens: 6_774_000, requestCount: 31 },
        { key: "glm-5.3", totalTokens: 934_000_000, requestCount: 6_593 },
        { key: "glm-5.3-flash", totalTokens: 266_000_000, requestCount: 2_205 },
        { key: "(invalid)", totalTokens: 0, requestCount: 4 },
        { key: "/cjd", totalTokens: 0, requestCount: 2 },
      ],
      { totalTokens: 934_000_000 + 6_774_000 + 266_000_000, requestCount: 8_835 },
    ).map((row) => row.key),
    ["glm-5.3", "glm-5.3-flash"],
  );
});

test("hourly token split matches the composition rule", () => {
  assert.deepEqual(
    splitHourlyTokens({ promptTokens: 50, cacheReadTokens: 20, completionTokens: 10 }),
    { uncachedPrompt: 30, cacheRead: 20, completion: 10 },
  );
});
