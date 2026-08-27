import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";
process.env.QUOTA_TIMEZONE = "Asia/Shanghai";

const {
  nextQuotaResetAt,
  quotaDayAt,
  quotaMonthStartDay,
  zonedDateRange,
  zonedMonthRange,
} = await import("../src/lib/quota-time.js");
const {
  appendOtherBucket,
  fillDailyUsage,
  summarizeDailyUsage,
} = await import("../src/lib/user-usage.js");
const { generateEnterpriseCode, ENTERPRISE_CODE_PATTERN } = await import("../src/lib/enterprise.js");

test("quota day changes exactly at QUOTA_TIMEZONE midnight", () => {
  assert.equal(quotaDayAt(new Date("2026-08-05T15:59:59.999Z"), "Asia/Shanghai"), "2026-08-05");
  assert.equal(quotaDayAt(new Date("2026-08-05T16:00:00.000Z"), "Asia/Shanghai"), "2026-08-06");
  assert.equal(
    nextQuotaResetAt(new Date("2026-08-05T08:00:00.000Z"), "Asia/Shanghai"),
    "2026-08-06T00:00:00+08:00",
  );
});

test("quota month starts at QUOTA_TIMEZONE local midnight on the first", () => {
  assert.equal(quotaMonthStartDay(new Date("2026-08-31T15:59:59.999Z"), "Asia/Shanghai"), "2026-08-01");
  assert.equal(quotaMonthStartDay(new Date("2026-08-31T16:00:00.000Z"), "Asia/Shanghai"), "2026-09-01");
  const august = zonedMonthRange(new Date("2026-08-15T08:00:00.000Z"), "Asia/Shanghai");
  assert.equal(august.from, "2026-08-01");
  assert.equal(august.to, "2026-08-31");
  assert.equal(august.start.toISOString(), "2026-07-31T16:00:00.000Z");
  assert.equal(august.endExclusive.toISOString(), "2026-08-31T16:00:00.000Z");
});

test("timezone date ranges use local closed days and survive DST", () => {
  const shanghai = zonedDateRange("2026-08-05", "2026-08-05", "Asia/Shanghai");
  assert.equal(shanghai.start.toISOString(), "2026-08-04T16:00:00.000Z");
  assert.equal(shanghai.endExclusive.toISOString(), "2026-08-05T16:00:00.000Z");

  const newYorkDst = zonedDateRange("2026-03-08", "2026-03-08", "America/New_York");
  assert.equal(
    newYorkDst.endExclusive.getTime() - newYorkDst.start.getTime(),
    23 * 60 * 60 * 1_000,
  );
});

test("enterprise codes are E plus eight unambiguous characters", () => {
  const code = generateEnterpriseCode(() => 0);
  assert.equal(code.length, 9);
  assert.match(code, ENTERPRISE_CODE_PATTERN);
  assert.equal(generateEnterpriseCode(() => 1) !== code, true);
});

test("daily usage is zero-filled and summary remains strongly consistent", () => {
  const daily = fillDailyUsage("2026-08-01", "2026-08-03", [{
    day: "2026-08-02",
    promptTokens: 7,
    completionTokens: 3,
    totalTokens: 10,
    requestCount: 2,
    errorCount: 1,
  }]);
  const summary = summarizeDailyUsage(daily);
  assert.deepEqual(daily.map((row) => row.day), ["2026-08-01", "2026-08-02", "2026-08-03"]);
  assert.equal(daily[0].successRate, null);
  assert.equal(summary.totalTokens, daily.reduce((sum, row) => sum + row.totalTokens, 0));
  assert.equal(summary.requestCount, daily.reduce((sum, row) => sum + row.requestCount, 0));
  assert.equal(summary.errorCount, daily.reduce((sum, row) => sum + row.errorCount, 0));
  assert.equal(summary.successRate, 0.5);
});

test("usage breakdown keeps Top N shape and folds the remainder into other", () => {
  assert.deepEqual(
    appendOtherBucket(
      [{ key: "provider-a", totalTokens: 80, requestCount: 8 }],
      { totalTokens: 100, requestCount: 10 },
    ),
    [
      { key: "provider-a", totalTokens: 80, requestCount: 8 },
      { key: "other", totalTokens: 20, requestCount: 2 },
    ],
  );
});
