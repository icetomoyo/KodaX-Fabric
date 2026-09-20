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
  externalDrainObservation,
  fiveHourResetAt,
  fiveHourWindowStart,
  hourStartOf,
  learnedCapResetFromMeta,
  learnedNextReset,
  mergeLearnedCapReset,
  quotaExhaustedLastError,
  remainingQuotaFraction,
  resolveGraphCoolingKind,
  weekStartOf,
  weeklyResetAt,
  withInFlightEstimate,
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

test("weekStartOf aligns to the local 19:00 UTC+8 fallback epoch", () => {
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

test("withInFlightEstimate counts in-flight requests at the observed per-request average", () => {
  const usage = withInFlightEstimate(
    {
      fiveHourCredits: 100,
      weeklyCredits: 200,
      fiveHourRequests: 10,
      weeklyRequests: 10,
    },
    5,
  );
  assert.equal(usage.fiveHourCredits, 150);
  assert.equal(usage.weeklyCredits, 250);

  assert.equal(
    withInFlightEstimate(
      { fiveHourCredits: 100, weeklyCredits: 200, fiveHourRequests: 10 },
      0,
    ).fiveHourCredits,
    100,
  );
  // 没有历史请求数就没有单请求均价，无法估算在途消耗。
  assert.equal(
    withInFlightEstimate({ fiveHourCredits: 100, weeklyCredits: 200 }, 5).fiveHourCredits,
    100,
  );
});

test("remainingQuotaFraction takes the tighter window and clamps to [0, 1]", () => {
  // 没配限额 → 没有配额压力。
  assert.equal(
    remainingQuotaFraction(
      { fiveHourCredits: 100, weeklyCredits: 0 },
      { fiveHourLimit: null, weeklyLimit: null },
    ),
    1,
  );
  // 双窗口取更紧的：5 小时剩 50%，周剩 20%。
  assert.ok(
    Math.abs(
      remainingQuotaFraction(
        { fiveHourCredits: 500, weeklyCredits: 8_000 },
        { fiveHourLimit: 1_000, weeklyLimit: 10_000 },
      ) - 0.2,
    ) < 1e-9,
  );
  // 超限 → 0。
  assert.equal(
    remainingQuotaFraction(
      { fiveHourCredits: 1_200, weeklyCredits: 0 },
      { fiveHourLimit: 1_000, weeklyLimit: null },
    ),
    0,
  );
});

test("learnedNextReset returns the learned instant or rolls it forward by the window", () => {
  const now = new Date("2026-09-20T07:33:36.000Z");
  // 学到的相位仍在未来 → 直接用。
  assert.equal(
    learnedNextReset({ weekly: "2026-09-24T07:33:36.000Z" }, "weekly", now)?.toISOString(),
    "2026-09-24T07:33:36.000Z",
  );
  // 已过去 → 按 7 天周期前滚到下一个未来时刻。
  assert.equal(
    learnedNextReset({ weekly: "2026-09-10T07:33:36.000Z" }, "weekly", now)?.toISOString(),
    "2026-09-24T07:33:36.000Z",
  );
  // 非法 ISO / 没学到该窗口 → null。
  assert.equal(learnedNextReset({ weekly: "not-a-date" }, "weekly", now), null);
  assert.equal(
    learnedNextReset({ fiveHour: "2026-09-24T07:33:36.000Z" }, "weekly", now),
    null,
  );
  assert.equal(learnedNextReset(null, "weekly", now), null);
});

test("mergeLearnedCapReset preserves other meta keys and merges per-kind phases", () => {
  const merged = mergeLearnedCapReset(
    {
      discoveredModels: ["glm-5.3"],
      learnedCapReset: { weekly: "2026-09-17T09:49:49.000Z" },
    },
    "five_hour",
    new Date("2026-09-20T12:00:00.000Z"),
  );
  assert.deepEqual(merged, {
    discoveredModels: ["glm-5.3"],
    learnedCapReset: {
      weekly: "2026-09-17T09:49:49.000Z",
      fiveHour: "2026-09-20T12:00:00.000Z",
      monthly: undefined,
    },
  });

  const learned = learnedCapResetFromMeta(merged);
  assert.equal(learned?.fiveHour, "2026-09-20T12:00:00.000Z");
  assert.equal(learned?.weekly, "2026-09-17T09:49:49.000Z");
  assert.equal(learned?.monthly, undefined);

  // other 类上限没有对应窗口键，原样返回。
  assert.deepEqual(mergeLearnedCapReset({ a: 1 }, "other", new Date()), { a: 1 });
});

test("learnedCapResetFromMeta rejects garbage input", () => {
  assert.equal(learnedCapResetFromMeta(null), null);
  assert.equal(learnedCapResetFromMeta("garbage"), null);
  assert.equal(learnedCapResetFromMeta({ learnedCapReset: "x" }), null);
  assert.equal(learnedCapResetFromMeta({ learnedCapReset: { weekly: 42 } }), null);
});

test("externalDrainObservation records a gap only well below the limit", () => {
  const now = new Date("2026-09-20T07:33:36.000Z");
  // 本地账本 200 / 限额 1000（<85%）→ 站外消耗下限 800。
  assert.deepEqual(
    externalDrainObservation({ kind: "weekly", localCredits: 200, limit: 1_000, now }),
    {
      kind: "weekly",
      localCredits: 200,
      limit: 1_000,
      externalEstimate: 800,
      observedAt: "2026-09-20T07:33:36.000Z",
    },
  );
  // ≥85% 属于正常漂移，不算站外消耗证据。
  assert.equal(
    externalDrainObservation({ kind: "weekly", localCredits: 850, limit: 1_000, now }),
    null,
  );
  assert.equal(
    externalDrainObservation({ kind: "five_hour", localCredits: 10, limit: null, now }),
    null,
  );
});
