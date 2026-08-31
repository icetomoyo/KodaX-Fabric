import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";
process.env.QUOTA_TIMEZONE = "Asia/Shanghai";

const {
  CREDENTIAL_WEEKLY_EPOCH,
  creditCoolingKind,
  evaluateCredentialQuota,
  fiveHourResetAt,
  fiveHourWindowStart,
  hourStartOf,
  quotaExhaustedLastError,
  resolveGraphCoolingKind,
  weekStartOf,
  weeklyResetAt,
} = await import("../src/lib/relay/credential-quota.js");

test("hourStartOf truncates to the UTC hour", () => {
  assert.equal(
    hourStartOf(new Date("2026-08-31T13:45:30.500Z")).toISOString(),
    "2026-08-31T13:00:00.000Z",
  );
  assert.equal(
    hourStartOf(new Date("2026-08-31T13:00:00.000Z")).toISOString(),
    "2026-08-31T13:00:00.000Z",
  );
});

test("five-hour window covers the current UTC hour plus the previous four", () => {
  const now = new Date("2026-08-31T13:45:00.000Z");
  assert.equal(fiveHourWindowStart(now).toISOString(), "2026-08-31T09:00:00.000Z");
  assert.equal(fiveHourResetAt(now).toISOString(), "2026-08-31T14:00:00.000Z");
});

test("five-hour window and reset cross a UTC day boundary", () => {
  const now = new Date("2026-09-01T01:20:00.000Z");
  assert.equal(fiveHourWindowStart(now).toISOString(), "2026-08-31T21:00:00.000Z");
  assert.equal(fiveHourResetAt(now).toISOString(), "2026-09-01T02:00:00.000Z");
});

test("weekStartOf aligns to 19:00 UTC+8 after the upstream 18:49 reset", () => {
  assert.equal(CREDENTIAL_WEEKLY_EPOCH.toISOString(), "2026-09-03T11:00:00.000Z");

  const atEpoch = new Date("2026-09-03T11:00:00.000Z");
  assert.equal(weekStartOf(atEpoch).toISOString(), "2026-09-03T11:00:00.000Z");
  assert.equal(weeklyResetAt(atEpoch).toISOString(), "2026-09-10T11:00:00.000Z");

  const midCycle = new Date("2026-09-05T00:00:00.000Z");
  assert.equal(weekStartOf(midCycle).toISOString(), "2026-09-03T11:00:00.000Z");
  assert.equal(weeklyResetAt(midCycle).toISOString(), "2026-09-10T11:00:00.000Z");
});

test("weekStartOf and weeklyResetAt cross the shared 7-day epoch", () => {
  const stillOldWeek = new Date("2026-09-03T10:49:00.000Z");
  assert.equal(weekStartOf(stillOldWeek).toISOString(), "2026-08-27T11:00:00.000Z");
  assert.equal(weeklyResetAt(stillOldWeek).toISOString(), "2026-09-03T11:00:00.000Z");

  const justBefore = new Date("2026-09-03T10:59:59.999Z");
  assert.equal(weekStartOf(justBefore).toISOString(), "2026-08-27T11:00:00.000Z");
  assert.equal(weeklyResetAt(justBefore).toISOString(), "2026-09-03T11:00:00.000Z");

  const nextCycle = new Date("2026-09-10T11:00:00.000Z");
  assert.equal(weekStartOf(nextCycle).toISOString(), "2026-09-10T11:00:00.000Z");
  assert.equal(weeklyResetAt(nextCycle).toISOString(), "2026-09-17T11:00:00.000Z");
});

test("evaluateCredentialQuota treats null limits as unlimited", () => {
  const now = new Date("2026-08-26T08:00:00.000Z");
  const status = evaluateCredentialQuota(
    { fiveHourCredits: 9_000, weeklyCredits: 90_000 },
    { fiveHourLimit: null, weeklyLimit: null },
    now,
  );
  assert.equal(status.exhausted, false);
  assert.equal(status.fiveHourExhausted, false);
  assert.equal(status.weeklyExhausted, false);
  assert.equal(status.exhaustedUntil, null);
  assert.equal(status.fiveHourLimit, null);
  assert.equal(status.weeklyLimit, null);
});

test("evaluateCredentialQuota exhausts a single five-hour window", () => {
  const now = new Date("2026-08-26T08:30:00.000Z");
  const status = evaluateCredentialQuota(
    { fiveHourCredits: 1_000, weeklyCredits: 1_000 },
    { fiveHourLimit: 1_000, weeklyLimit: 10_000 },
    now,
  );
  assert.equal(status.exhausted, true);
  assert.equal(status.fiveHourExhausted, true);
  assert.equal(status.weeklyExhausted, false);
  assert.equal(status.exhaustedUntil?.toISOString(), fiveHourResetAt(now).toISOString());
  assert.equal(creditCoolingKind(status), "five_hour");
  assert.equal(quotaExhaustedLastError(status), "5 小时积分达到 85%，冷却至窗口重置");
});

test("evaluateCredentialQuota cools five-hour usage at 85% of the limit", () => {
  const now = new Date("2026-08-26T08:30:00.000Z");
  const below = evaluateCredentialQuota(
    { fiveHourCredits: 849, weeklyCredits: 0 },
    { fiveHourLimit: 1_000, weeklyLimit: 10_000 },
    now,
  );
  assert.equal(below.fiveHourExhausted, false);
  assert.equal(below.exhausted, false);

  const atThreshold = evaluateCredentialQuota(
    { fiveHourCredits: 850, weeklyCredits: 0 },
    { fiveHourLimit: 1_000, weeklyLimit: 10_000 },
    now,
  );
  assert.equal(atThreshold.fiveHourExhausted, true);
  assert.equal(atThreshold.exhausted, true);
});

test("evaluateCredentialQuota treats usage equal to the weekly limit as exhausted", () => {
  const now = new Date("2026-08-26T08:30:00.000Z");
  const status = evaluateCredentialQuota(
    { fiveHourCredits: 100, weeklyCredits: 50_000 },
    { fiveHourLimit: 10_000, weeklyLimit: 50_000 },
    now,
  );
  assert.equal(status.exhausted, true);
  assert.equal(status.fiveHourExhausted, false);
  assert.equal(status.weeklyExhausted, true);
  assert.equal(status.exhaustedUntil?.toISOString(), weeklyResetAt(now).toISOString());
  assert.equal(creditCoolingKind(status), "weekly");
  assert.equal(quotaExhaustedLastError(status), "周积分达到 95%，冷却至窗口重置");
});

test("evaluateCredentialQuota cools weekly usage at 95% of the limit", () => {
  const now = new Date("2026-08-26T08:30:00.000Z");
  const below = evaluateCredentialQuota(
    { fiveHourCredits: 0, weeklyCredits: 9_499 },
    { fiveHourLimit: 10_000, weeklyLimit: 10_000 },
    now,
  );
  assert.equal(below.weeklyExhausted, false);
  assert.equal(below.exhausted, false);

  const atThreshold = evaluateCredentialQuota(
    { fiveHourCredits: 0, weeklyCredits: 9_500 },
    { fiveHourLimit: 10_000, weeklyLimit: 10_000 },
    now,
  );
  assert.equal(atThreshold.weeklyExhausted, true);
  assert.equal(atThreshold.exhausted, true);
});

test("evaluateCredentialQuota takes the later reset when both windows are exhausted", () => {
  const now = new Date("2026-08-26T08:30:00.000Z");
  const fiveHourReset = fiveHourResetAt(now);
  const weeklyReset = weeklyResetAt(now);
  assert.ok(weeklyReset.getTime() > fiveHourReset.getTime());

  const status = evaluateCredentialQuota(
    { fiveHourCredits: 2_000, weeklyCredits: 20_000 },
    { fiveHourLimit: 1_000, weeklyLimit: 10_000 },
    now,
  );
  assert.equal(status.exhausted, true);
  assert.equal(status.fiveHourExhausted, true);
  assert.equal(status.weeklyExhausted, true);
  assert.equal(status.exhaustedUntil?.toISOString(), weeklyReset.toISOString());
  assert.equal(creditCoolingKind(status), "weekly");
  assert.equal(resolveGraphCoolingKind("active", status), "weekly");
});

test("resolveGraphCoolingKind keeps short rate-limit cooling as other", () => {
  assert.equal(
    resolveGraphCoolingKind("cooling", { fiveHourExhausted: false, weeklyExhausted: false }),
    "other",
  );
  assert.equal(
    resolveGraphCoolingKind("active", { fiveHourExhausted: false, weeklyExhausted: false }),
    null,
  );
});
