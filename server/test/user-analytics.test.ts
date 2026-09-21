import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

test("user analytics rank query groups request audits by employee for the day", async () => {
  const { buildUserAnalyticsRankQuery } = await import("../src/routes/admin/user-analytics.js");
  const compiled = buildUserAnalyticsRankQuery(
    new Date("2026-09-18T16:00:00.000Z"),
    new Date("2026-09-19T16:00:00.000Z"),
  ).toSQL();
  const sql = compiled.sql.replace(/\s+/g, " ");
  assert.match(sql, /"request_audits"/);
  assert.match(sql, /group by/);
  assert.match(sql, /sum\("request_audits"\."total_tokens"\)/);
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

test("admin user analytics page sits under 用量分析 and keeps a contribution heatmap", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const layout = readFileSync(resolve(root, "web/src/layouts/AdminLayout.vue"), "utf8");
  const router = readFileSync(resolve(root, "web/src/router/index.ts"), "utf8");
  const view = readFileSync(resolve(root, "web/src/views/admin/UserAnalyticsView.vue"), "utf8");
  assert.match(
    layout,
    /index="\/admin\/usage">用量分析[\s\S]*index="\/admin\/user-analytics">用户分析/,
  );
  assert.match(router, /name: "admin-user-analytics"/);
  assert.match(router, /path: "user-analytics"/);
  assert.match(view, /contribution-graph/);
  assert.match(view, /单日使用量/);
  assert.match(view, /placeholder="输入姓名"/);
  assert.match(view, /visibleRanks/);
});
