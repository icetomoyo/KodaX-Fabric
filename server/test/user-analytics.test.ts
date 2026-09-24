import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const {
  buildContributionGrid,
  contributionLevel,
  contributionStartSunday,
  fillHourCounts,
  usageStreaks,
  weekdayWeekendSplit,
} = await import("../src/lib/user-analytics.js");
const { adminUserAnalyticsRoutes } = await import("../src/routes/admin/user-analytics.js");

test("contribution grid is Sunday-first and pads future cells after to", () => {
  const grid = buildContributionGrid("2026-09-21", [
    { day: "2026-09-21", totalTokens: 100, requestCount: 2 },
    { day: "2026-09-20", totalTokens: 40, requestCount: 1 },
  ], 2);
  assert.equal(contributionStartSunday("2026-09-21", 2), "2026-09-13");
  assert.equal(grid.weeks.length, 2);
  assert.equal(grid.weeks[0]?.days.length, 7);
  assert.equal(grid.weeks[1]?.days[0]?.date, "2026-09-20");
  const today = grid.weeks[1]?.days.find((cell) => cell?.date === "2026-09-21");
  assert.equal(today?.totalTokens, 100);
  assert.equal(today?.level, 4);
  assert.equal(grid.weeks[1]?.days[2], null);
});

test("contributionLevel buckets relative to the user's max day", () => {
  assert.equal(contributionLevel(0, 100), 0);
  assert.equal(contributionLevel(25, 100), 1);
  assert.equal(contributionLevel(50, 100), 2);
  assert.equal(contributionLevel(75, 100), 3);
  assert.equal(contributionLevel(100, 100), 4);
});

test("usageStreaks counts current run even if today is empty", () => {
  const days = [
    { day: "2026-09-18", totalTokens: 10 },
    { day: "2026-09-19", totalTokens: 10 },
    { day: "2026-09-20", totalTokens: 10 },
  ];
  assert.deepEqual(usageStreaks(days, "2026-09-21"), {
    current: 3,
    longest: 3,
    activeDays: 3,
  });
});

test("weekdayWeekendSplit uses calendar date weekday", () => {
  const split = weekdayWeekendSplit([
    { day: "2026-09-19", totalTokens: 10 },
    { day: "2026-09-20", totalTokens: 5 },
    { day: "2026-09-21", totalTokens: 20 },
  ]);
  assert.equal(split.weekendTokens, 15);
  assert.equal(split.weekdayTokens, 20);
});

test("fillHourCounts always returns 24 buckets", () => {
  const hours = fillHourCounts([{ hour: 14, totalTokens: 9, requestCount: 2 }]);
  assert.equal(hours.length, 24);
  assert.equal(hours[14]?.hour, "14:00");
  assert.equal(hours[14]?.totalTokens, 9);
  assert.equal(hours[0]?.totalTokens, 0);
});

test("user analytics rank query reads the daily usage counters", async () => {
  const { buildUserAnalyticsRankQuery } = await import("../src/routes/admin/user-analytics.js");
  const compiled = buildUserAnalyticsRankQuery("2026-09-18").toSQL();
  const sqlText = compiled.sql.replace(/\s+/g, " ");
  assert.match(sqlText, /"usage_counters_daily"/);
  assert.match(
    sqlText,
    /inner join "employees" on "usage_counters_daily"\."employee_id" = "employees"\."id"/,
  );
  assert.doesNotMatch(sqlText, /"request_audits"/);
  assert.doesNotMatch(sqlText, /group by/);
  assert.equal(compiled.params.includes("2026-09-18"), true);
});

test("user analytics routes expose ranks and require a session", async () => {
  const app = Fastify();
  await app.register(adminUserAnalyticsRoutes);
  await app.ready();
  try {
    assert.equal(app.hasRoute({ method: "GET", url: "/api/admin/user-analytics" }), true);
    const unauth = await app.inject({ method: "GET", url: "/api/admin/user-analytics" });
    assert.equal(unauth.statusCode, 401);
  } finally {
    await app.close();
  }
});

const employeeSession = {
  sub: "17",
  role: "employee" as never,
  phone: "13800000017",
  name: "Employee17",
  mustChangePassword: false,
};

function attachEmployeeSession() {
  return async (req: { session?: typeof employeeSession; employeeId?: number }) => {
    req.session = employeeSession;
    req.employeeId = Number(employeeSession.sub);
  };
}

test("me analytics endpoint exists, requires a session and rejects future days", async () => {
  const { meRoutes } = await import("../src/routes/me.js");
  const app = Fastify();
  await app.register(meRoutes);
  await app.ready();
  try {
    assert.equal(app.hasRoute({ method: "GET", url: "/api/me/analytics" }), true);
    const unauth = await app.inject({ method: "GET", url: "/api/me/analytics" });
    assert.equal(unauth.statusCode, 401);
  } finally {
    await app.close();
  }

  const authed = Fastify();
  authed.addHook("onRequest", attachEmployeeSession());
  await authed.register(meRoutes);
  await authed.ready();
  try {
    const badDay = await authed.inject({ method: "GET", url: "/api/me/analytics?day=2999-01-01" });
    assert.equal(badDay.statusCode, 400);
    assert.match(badDay.json().message, /不能晚于今天/);
    const badFormat = await authed.inject({ method: "GET", url: "/api/me/analytics?day=2026-9-1" });
    assert.equal(badFormat.statusCode, 400);
  } finally {
    await authed.close();
  }
});
