import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";
process.env.QUOTA_TIMEZONE = "Asia/Shanghai";

const {
  CREDENTIAL_WEEKLY_EPOCH,
  aggregateCredentialUsage,
  activeFiveHourWindow,
  creditCoolingKind,
  evaluateCredentialQuota,
  externalDrainObservation,
  fiveHourResetAt,
  fiveHourWindowStart,
  hourStartOf,
  nextFiveHourResetAt,
  nextWeeklyResetAt,
  remainingQuotaFraction,
  resolveGraphCoolingKind,
  weekStartOf,
  weeklyResetAt,
  weeklyWindowStart,
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

test("activeFiveHourWindow covers [anchor, anchor+5h) and expires exactly at the boundary", () => {
  const anchor = new Date("2026-09-22T01:00:00.000Z");
  // 窗口进行中。
  assert.deepEqual(activeFiveHourWindow(anchor, new Date("2026-09-22T04:30:00.000Z")), {
    start: new Date("2026-09-22T01:00:00.000Z"),
    end: new Date("2026-09-22T06:00:00.000Z"),
  });
  // 锚点+5h 整点即过期（满血）；无锚点 → null（走旧滚动兜底）。
  assert.equal(activeFiveHourWindow(anchor, new Date("2026-09-22T06:00:00.000Z")), null);
  assert.equal(activeFiveHourWindow(anchor, new Date("2026-09-22T10:00:00.000Z")), null);
  assert.equal(activeFiveHourWindow(null, new Date("2026-09-22T04:30:00.000Z")), null);
});

test("nextFiveHourResetAt only reports a reset while the anchored window is active", () => {
  const anchor = new Date("2026-09-22T01:00:00.000Z");
  assert.equal(
    nextFiveHourResetAt(anchor, new Date("2026-09-22T04:30:00.000Z"))?.toISOString(),
    "2026-09-22T06:00:00.000Z",
  );
  // 6 点后窗口已过期：额度已满，重置时刻由下次首用决定，返回 null。
  assert.equal(nextFiveHourResetAt(anchor, new Date("2026-09-22T08:00:00.000Z")), null);
  assert.equal(nextFiveHourResetAt(null, new Date("2026-09-22T08:00:00.000Z")), null);
});

test("weeklyWindowStart rolls the learned per-key phase by whole weeks", () => {
  // GLM-50 实测相位：2026-09-24 18:49 Asia/Shanghai = 10:49Z。
  const learned = new Date("2026-09-24T10:49:00.000Z");
  // 学到的时刻仍在未来 → 当前窗口从相位−7d 开始。
  assert.equal(
    weeklyWindowStart(learned, new Date("2026-09-22T02:00:00.000Z")).toISOString(),
    "2026-09-17T10:49:00.000Z",
  );
  // 相位过后 → 滚到包含当前时刻的那一期。
  assert.equal(
    weeklyWindowStart(learned, new Date("2026-09-25T00:00:00.000Z")).toISOString(),
    "2026-09-24T10:49:00.000Z",
  );
  // 三个周期后。
  assert.equal(
    weeklyWindowStart(learned, new Date("2026-10-08T00:00:00.000Z")).toISOString(),
    "2026-10-01T10:49:00.000Z",
  );
  // 未学到相位 → 共享 epoch 对齐。
  assert.equal(
    weeklyWindowStart(null, new Date("2026-09-22T02:00:00.000Z")).toISOString(),
    weekStartOf(new Date("2026-09-22T02:00:00.000Z")).toISOString(),
  );
});

test("nextWeeklyResetAt lands on the learned phase, not the epoch alignment", () => {
  const learned = new Date("2026-09-24T10:49:00.000Z");
  assert.equal(
    nextWeeklyResetAt(learned, new Date("2026-09-22T02:00:00.000Z")).toISOString(),
    "2026-09-24T10:49:00.000Z",
  );
  assert.equal(
    nextWeeklyResetAt(null, new Date("2026-09-22T02:00:00.000Z")).toISOString(),
    weeklyResetAt(new Date("2026-09-22T02:00:00.000Z")).toISOString(),
  );
});

test("evaluateCredentialQuota resets anchored windows at their own boundaries", () => {
  const now = new Date("2026-09-22T04:30:00.000Z");
  const anchors = {
    fiveHourAnchor: new Date("2026-09-22T01:00:00.000Z"),
    weeklyResetAt: new Date("2026-09-24T10:49:00.000Z"),
  };
  // 5h 打满 → 冷却终点是锚点+5h（06:00），不再是「下一个整点」。
  const fiveHour = evaluateCredentialQuota(
    { fiveHourCredits: 1_000, weeklyCredits: 0 },
    { fiveHourLimit: 1_000, weeklyLimit: 10_000 },
    now,
    anchors,
  );
  assert.equal(fiveHour.exhaustedUntil?.toISOString(), "2026-09-22T06:00:00.000Z");

  // 周积分打满 → 冷却终点是学到的相位，而不是 epoch 对齐点。
  const weekly = evaluateCredentialQuota(
    { fiveHourCredits: 0, weeklyCredits: 10_000 },
    { fiveHourLimit: 1_000, weeklyLimit: 10_000 },
    now,
    anchors,
  );
  assert.equal(weekly.exhaustedUntil?.toISOString(), "2026-09-24T10:49:00.000Z");
});

test("anchored 5h usage follows the first-use window: 1点锚定, 4点打满, 6点整窗清零, 10点重新起算", () => {
  const credentialId = 50;
  const anchors = (anchor: Date | null) => new Map([[credentialId, {
    fiveHourAnchor: anchor,
    weeklyResetAt: null,
  }]]);

  // 1点-4点 消耗 35000 积分（小时桶），5h 限额 35000。
  const buckets = [
    { credentialId, hourStart: new Date("2026-09-22T01:00:00.000Z"), totalTokens: 1_000, totalCredits: "12000", requestCount: 30 },
    { credentialId, hourStart: new Date("2026-09-22T02:00:00.000Z"), totalTokens: 1_000, totalCredits: "12000", requestCount: 30 },
    { credentialId, hourStart: new Date("2026-09-22T03:00:00.000Z"), totalTokens: 1_000, totalCredits: "11000", requestCount: 30 },
  ];

  // 04:30：窗口 [01:00, 06:00) 进行中，账本 35000/35000 → 打满。
  const atFourThirty = aggregateCredentialUsage(
    buckets,
    [credentialId],
    anchors(new Date("2026-09-22T01:00:00.000Z")),
    new Date("2026-09-22T04:30:00.000Z"),
  ).get(credentialId);
  assert.equal(atFourThirty?.fiveHourCredits, 35_000);
  const quota = evaluateCredentialQuota(
    atFourThirty!,
    { fiveHourLimit: 35_000, weeklyLimit: 155_000 },
    new Date("2026-09-22T04:30:00.000Z"),
    { fiveHourAnchor: new Date("2026-09-22T01:00:00.000Z"), weeklyResetAt: null },
  );
  assert.equal(quota.fiveHourExhausted, true);
  assert.equal(quota.exhaustedUntil?.toISOString(), "2026-09-22T06:00:00.000Z");

  // 06:30：窗口已过期 → 0/35000，立刻满血（不再等本地滚动桶滑出）。
  const atSixThirty = aggregateCredentialUsage(
    buckets,
    [credentialId],
    anchors(new Date("2026-09-22T01:00:00.000Z")),
    new Date("2026-09-22T06:30:00.000Z"),
  ).get(credentialId);
  assert.equal(atSixThirty?.fiveHourCredits, 0);

  // 10 点员工再次调用（新桶 10:00），锚点被首用重写为 10:00 → 下次重置 15:00。
  const newWindowBuckets = [
    ...buckets,
    { credentialId, hourStart: new Date("2026-09-22T10:00:00.000Z"), totalTokens: 100, totalCredits: "500", requestCount: 2 },
  ];
  const reanchored = new Date("2026-09-22T10:00:00.000Z");
  const atTenOhFive = aggregateCredentialUsage(
    newWindowBuckets,
    [credentialId],
    anchors(reanchored),
    new Date("2026-09-22T10:05:00.000Z"),
  ).get(credentialId);
  // 旧窗口（1点-4点）的桶不在 [10:00, 15:00) 内，不计入。
  assert.equal(atTenOhFive?.fiveHourCredits, 500);
  assert.equal(
    nextFiveHourResetAt(reanchored, new Date("2026-09-22T10:05:00.000Z"))?.toISOString(),
    "2026-09-22T15:00:00.000Z",
  );
});

test("weekly usage zeroes at the learned phase flip (GLM-50 2026-09-24 18:49)", () => {
  const credentialId = 51;
  const learned = new Date("2026-09-24T10:49:00.000Z");
  const anchors = new Map([[credentialId, { fiveHourAnchor: null, weeklyResetAt: learned }]]);

  // 周窗口内累计 92000；翻转到 09-24 10:49Z（=18:49 +08:00）后应立即归零。
  const buckets = [
    { credentialId, hourStart: new Date("2026-09-23T02:00:00.000Z"), totalTokens: 0, totalCredits: "92000", requestCount: 100 },
    { credentialId, hourStart: new Date("2026-09-24T11:00:00.000Z"), totalTokens: 0, totalCredits: "1000", requestCount: 2 },
  ];
  const beforeFlip = aggregateCredentialUsage(
    [buckets[0]],
    [credentialId],
    anchors,
    new Date("2026-09-24T02:00:00.000Z"),
  ).get(credentialId);
  assert.equal(beforeFlip?.weeklyCredits, 92_000);

  const afterFlip = aggregateCredentialUsage(
    buckets,
    [credentialId],
    anchors,
    new Date("2026-09-24T12:00:00.000Z"),
  ).get(credentialId);
  // 09-24 10:49Z 翻转：之前的 92000 不再计入，只有翻转后的 1000。
  assert.equal(afterFlip?.weeklyCredits, 1_000);
});

test("unanchored keys keep the legacy rolling five-hour window", () => {
  const credentialId = 60;
  const now = new Date("2026-09-22T04:30:00.000Z");
  const buckets = [
    { credentialId, hourStart: new Date("2026-09-21T23:00:00.000Z"), totalTokens: 0, totalCredits: "5000", requestCount: 1 },
    { credentialId, hourStart: new Date("2026-09-22T01:00:00.000Z"), totalTokens: 0, totalCredits: "7000", requestCount: 1 },
  ];
  // 滚动窗口起点 00:00（04:30 的整点 −4h）→ 只计入 01:00 的桶。
  const usage = aggregateCredentialUsage(buckets, [credentialId], null, now).get(credentialId);
  assert.equal(usage?.fiveHourCredits, 7_000);
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
