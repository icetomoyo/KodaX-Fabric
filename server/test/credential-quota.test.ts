import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";
process.env.QUOTA_TIMEZONE = "Asia/Shanghai";

const {
  evaluateCredentialQuota,
  fiveHourResetAt,
  fiveHourWindowStart,
  hourStartOf,
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

test("weekStartOf is Monday 00:00 in QUOTA_TIMEZONE", () => {
  const midweek = new Date("2026-08-26T08:00:00.000Z");
  assert.equal(weekStartOf(midweek).toISOString(), "2026-08-23T16:00:00.000Z");
  assert.equal(weeklyResetAt(midweek).toISOString(), "2026-08-30T16:00:00.000Z");
});

test("weekStartOf and weeklyResetAt cross Sunday into Monday in QUOTA_TIMEZONE", () => {
  const sundayEvening = new Date("2026-08-30T15:59:59.999Z");
  assert.equal(weekStartOf(sundayEvening).toISOString(), "2026-08-23T16:00:00.000Z");
  assert.equal(weeklyResetAt(sundayEvening).toISOString(), "2026-08-30T16:00:00.000Z");

  const mondayMidnight = new Date("2026-08-30T16:00:00.000Z");
  assert.equal(weekStartOf(mondayMidnight).toISOString(), "2026-08-30T16:00:00.000Z");
  assert.equal(weeklyResetAt(mondayMidnight).toISOString(), "2026-09-06T16:00:00.000Z");
});

test("evaluateCredentialQuota treats null limits as unlimited", () => {
  const now = new Date("2026-08-26T08:00:00.000Z");
  const status = evaluateCredentialQuota(
    { fiveHourCredits: 9_000, weeklyCredits: 90_000 },
    { fiveHourLimit: null, weeklyLimit: null },
    now,
  );
  assert.equal(status.exhausted, false);
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
  assert.equal(status.exhaustedUntil?.toISOString(), fiveHourResetAt(now).toISOString());
});

test("evaluateCredentialQuota treats usage equal to the weekly limit as exhausted", () => {
  const now = new Date("2026-08-26T08:30:00.000Z");
  const status = evaluateCredentialQuota(
    { fiveHourCredits: 100, weeklyCredits: 50_000 },
    { fiveHourLimit: 10_000, weeklyLimit: 50_000 },
    now,
  );
  assert.equal(status.exhausted, true);
  assert.equal(status.exhaustedUntil?.toISOString(), weeklyResetAt(now).toISOString());
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
  assert.equal(status.exhaustedUntil?.toISOString(), weeklyReset.toISOString());
});
