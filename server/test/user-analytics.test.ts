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

test("migrate backfills usage_counters_daily from historical request audits", async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const migrateSource = readFileSync(resolve(root, "src/db/migrate.ts"), "utf8");
  assert.match(migrateSource, /INSERT INTO usage_counters_daily/);
  assert.match(migrateSource, /FROM request_audits ra/);
  assert.match(migrateSource, /ON CONFLICT \(day, employee_id\) DO UPDATE/);
});

test("user analytics rejects future days instead of throwing in zonedDateRange", async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const source = readFileSync(resolve(root, "src/routes/admin/user-analytics.ts"), "utf8");
  assert.match(source, /day > today/);
  assert.match(source, /日期不能晚于今天/);
});

test("daily credit detail is sampled from the latest rows with a truncation flag", async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const source = readFileSync(resolve(root, "src/routes/admin/user-analytics.ts"), "utf8");
  assert.match(source, /orderBy\(desc\(requestAudits\.createdAt\), desc\(requestAudits\.id\)\)/);
  assert.match(source, /limit\(5_001\)/);
  assert.match(source, /creditsEstimated: detailTruncated/);
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
  assert.match(layout, />数据分析</);
  assert.match(
    layout,
    /index="\/admin\/usage">用量分析[\s\S]*index="\/admin\/user-analytics">用户分析/,
  );
  assert.match(router, /name: "admin-user-analytics"/);
  assert.match(router, /path: "user-analytics"/);
  assert.match(view, /contribution-graph/);
  assert.match(view, /单日使用量/);
  assert.match(view, /搜索姓名查看任何人（不限榜内）/);
  assert.match(view, /:remote-method="searchEmployees"/);
  assert.doesNotMatch(view, /visibleRanks/);
  assert.match(view, /class="detail-pane"/);
  assert.match(view, /\.detail-pane \{[\s\S]*overflow: auto/);
  assert.match(layout, /'is-fill': route.path === '\/admin\/user-analytics'/);
});

test("user analytics credits use settled values with the settlement interval", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const source = readFileSync(resolve(root, "src/routes/admin/user-analytics.ts"), "utf8");
  assert.match(source, /const startedAt = row\.startedAt \?\? row\.createdAt;/);
  assert.match(source, /const settled = row\.requestCredits != null \? Number\(row\.requestCredits\) : null;/);
  assert.match(
    source,
    /defaultCreditRateFor\(row\.clientModel\),\n        startedAt,\n        row\.createdAt,\n      \);/,
  );
});

test("team_members has a leading-employee index for department lookups", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const schema = readFileSync(resolve(root, "src/db/schema/index.ts"), "utf8");
  assert.match(schema, /team_members_employee_team_idx"\)\.on\(t\.employeeId, t\.teamId\)/);
  const migration = readFileSync(
    resolve(root, "drizzle/0050_team_members_employee_idx.sql"),
    "utf8",
  );
  assert.match(migration, /CREATE INDEX "team_members_employee_team_idx"/);
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

test("me analytics reuses loadSelectedUser for the acting employee only", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const source = readFileSync(resolve(root, "src/routes/me.ts"), "utf8");
  assert.match(source, /loadSelectedUser\(meId\(req\), day\)/);
  assert.doesNotMatch(source, /employeeId.*user-analytics/);
});

test("personal 工作台 renders the analytics panel, 调用记录 stays a plain log table", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const home = readFileSync(resolve(root, "web/src/views/me/HomeView.vue"), "utf8");
  assert.match(home, /contribution-graph/);
  assert.match(home, /\/api\/me\/analytics/);
  assert.match(home, /近一年调用热力图|调用热力图|aria-label="近一年调用热力图"/);
  assert.match(home, /近一年 Tokens/);
  const logs = readFileSync(resolve(root, "web/src/views/me/LogsView.vue"), "utf8");
  assert.doesNotMatch(logs, /contribution-graph/);
  assert.doesNotMatch(logs, /\/api\/me\/analytics/);
  assert.match(logs, /\/api\/me\/logs/);
});
