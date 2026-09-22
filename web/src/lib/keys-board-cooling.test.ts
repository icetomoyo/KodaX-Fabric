import assert from "node:assert/strict";
import test from "node:test";
import {
  coolingLaneFromLastError,
  isShortRateLimitCooling,
  vendorCodeFromLastError,
} from "./keys-board-cooling.ts";

const intl1310 =
  "[1310] You have reached the 7-day usage limit. You can continue using it after 2026-09-21 15:29:59. If you need overage pay-as-you-go access, please contact your admin to enable it.";

const intl1308 =
  "[1308] You have reached the 5-hour usage limit. You can continue using it after 2026-09-21 18:00:00.";

test("vendorCodeFromLastError reads the bracketed GLM code", () => {
  assert.equal(vendorCodeFromLastError(intl1310), "1310");
  assert.equal(vendorCodeFromLastError("已达到 7 天使用上限"), null);
});

test("1310 English 7-day usage limit is weekly even when remaining cool time is under 5 hours", () => {
  assert.equal(
    coolingLaneFromLastError({
      lastError: intl1310,
      coolUntil: "2026-09-21T07:29:59.000Z",
      now: new Date("2026-09-21T04:00:00.000Z"),
    }),
    "cooling_weekly",
  );
});

test("1310 Chinese 7-day cap stays weekly", () => {
  assert.equal(
    coolingLaneFromLastError({
      lastError: "[1310] 已达到 7 天使用上限，2026-09-21 15:29:59 后可继续使用。",
    }),
    "cooling_weekly",
  );
});

test("bare 1310 without Chinese or English 7-day wording is still weekly", () => {
  assert.equal(
    coolingLaneFromLastError({
      lastError: "[1310] cap",
      coolUntil: "2026-09-21T07:00:00.000Z",
      now: new Date("2026-09-21T06:00:00.000Z"),
    }),
    "cooling_weekly",
  );
});

test("1308 English 5-hour usage limit is five-hour cooling", () => {
  assert.equal(coolingLaneFromLastError({ lastError: intl1308 }), "cooling_5h");
});

test("unknown cooling with remaining under 6 hours stays five-hour", () => {
  assert.equal(
    coolingLaneFromLastError({
      lastError: "HTTP 429",
      coolUntil: "2026-09-21T07:00:00.000Z",
      now: new Date("2026-09-21T04:00:00.000Z"),
    }),
    "cooling_5h",
  );
});

test("1310 is never classified as a short rate-limit lane", () => {
  assert.equal(isShortRateLimitCooling(intl1310), false);
  assert.equal(isShortRateLimitCooling("[1308] You have reached the 5-hour usage limit."), false);
  assert.equal(isShortRateLimitCooling("HTTP 429：上游限流，凭证已进入冷却"), true);
});

test("weekly quota heuristic needs a positive limit", () => {
  assert.equal(
    coolingLaneFromLastError({ lastError: "HTTP 429", weeklyCreditLimit: 0, weeklyCredits: 0 }),
    "cooling_5h",
  );
  assert.equal(
    coolingLaneFromLastError({ lastError: "HTTP 429", weeklyCreditLimit: 100, weeklyCredits: 95 }),
    "cooling_weekly",
  );
  assert.equal(
    coolingLaneFromLastError({ lastError: "HTTP 429", weeklyCreditLimit: 100, weeklyCredits: 20 }),
    "cooling_5h",
  );
});

test("bare vendor code without brackets is recognized", () => {
  assert.equal(vendorCodeFromLastError("错误码 1319：quota exceeded"), "1319");
  assert.equal(vendorCodeFromLastError("no code here"), null);
});

test("quota and plan-expiry wording never enters the rate-limit lane", () => {
  assert.equal(isShortRateLimitCooling(null), false);
  assert.equal(isShortRateLimitCooling(""), false);
  assert.equal(isShortRateLimitCooling("429 已达到使用上限"), false);
  assert.equal(isShortRateLimitCooling("429 余额不足"), false);
  assert.equal(isShortRateLimitCooling("429 套餐已到期"), false);
  assert.equal(isShortRateLimitCooling("429 套餐已失效"), false);
  assert.equal(isShortRateLimitCooling("429 上游限流"), true);
});
