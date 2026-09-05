import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";
process.env.QUOTA_TIMEZONE = "Asia/Shanghai";

const {
  buildAnalyticsByModelQuery,
  buildAnalyticsDailyTrendQuery,
  buildAnalyticsHourlyTrendQuery,
  buildByProviderTodayQuery,
  buildTodayAuditWhere,
  buildTodayTeamTokensQuery,
  buildTopDepartmentsTodayQuery,
  buildTopEnterprisesTodayQuery,
  buildTopMembersTodayQuery,
  buildTopTeamsTodayQuery,
} = await import("../src/routes/admin/overview.js");

/** 2026-09-04 10:00 in Asia/Shanghai — after UTC midnight, so current_date would already be the 4th. */
const SHANGHAI_MORNING_AFTER_UTC_MIDNIGHT = new Date("2026-09-04T02:00:00.000Z");

test("workbench provider totals fall back to the Key channel when provider_code is missing", () => {
  const compiled = buildByProviderTodayQuery(undefined).toSQL().sql.replace(/\s+/g, " ");
  assert.match(compiled, /coalesce\("request_audits"\."provider_code", "providers"\."code"\)/);
  assert.match(compiled, /left join "product_lines"/);
  assert.match(compiled, /left join "providers"/);
});

test("workbench today request window is the quota timezone day, not created_at::date = current_date", () => {
  const compiled = buildTodayAuditWhere(SHANGHAI_MORNING_AFTER_UTC_MIDNIGHT).toSQL();
  const sql = compiled.sql.replace(/\s+/g, " ");
  assert.doesNotMatch(sql, /current_date/);
  assert.doesNotMatch(sql, /::date/);
  assert.match(sql, /"request_audits"\."created_at"/);
  const params = compiled.params.map((value) =>
    value instanceof Date ? value.toISOString() : String(value),
  );
  assert.ok(params.includes("2026-09-03T16:00:00.000Z"), params.join(","));
  assert.ok(params.includes("2026-09-04T16:00:00.000Z"), params.join(","));
});

test("workbench today token total sums team daily counters on the quota day", () => {
  const compiled = buildTodayTeamTokensQuery({ now: SHANGHAI_MORNING_AFTER_UTC_MIDNIGHT }).toSQL();
  const sql = compiled.sql.replace(/\s+/g, " ");
  assert.doesNotMatch(sql, /current_date/);
  assert.doesNotMatch(sql, /request_audits/);
  assert.match(sql, /sum\("total_tokens"\)/);
  assert.ok(
    compiled.params.map(String).includes("2026-09-04"),
    compiled.params.map(String).join(","),
  );
});

test("workbench top teams today read the same quota day as the token total", () => {
  const compiled = buildTopTeamsTodayQuery({ now: SHANGHAI_MORNING_AFTER_UTC_MIDNIGHT }).toSQL();
  const sql = compiled.sql.replace(/\s+/g, " ");
  assert.doesNotMatch(sql, /current_date/);
  assert.match(sql, /"usage_counters_team_daily"/);
  assert.match(sql, /"departments"/);
  assert.match(sql, /"is_default"/);
  assert.ok(
    compiled.params.map(String).includes("2026-09-04"),
    compiled.params.map(String).join(","),
  );
});

test("workbench today ranks roll up the org chain from team daily counters", () => {
  const now = SHANGHAI_MORNING_AFTER_UTC_MIDNIGHT;
  const enterprises = buildTopEnterprisesTodayQuery({ now }).toSQL().sql.replace(/\s+/g, " ");
  const departments = buildTopDepartmentsTodayQuery({ now }).toSQL().sql.replace(/\s+/g, " ");
  const members = buildTopMembersTodayQuery({ now }).toSQL().sql.replace(/\s+/g, " ");
  assert.match(enterprises, /group by "enterprises"\."id"/);
  assert.match(departments, /group by "departments"\."id"/);
  assert.match(departments, /"enterprises"\."name"/);
  assert.match(members, /"employees"\."name"/);
  assert.match(members, /"departments"\."name"/);
  assert.match(members, /"is_default"/);
  for (const sql of [enterprises, departments, members]) {
    assert.match(sql, /"usage_counters_team_daily"/);
    assert.doesNotMatch(sql, /current_date/);
  }
});

test("workbench analytics daily trend reads team counters over the quota day range", () => {
  const compiled = buildAnalyticsDailyTrendQuery("2026-08-29", "2026-09-04").toSQL();
  const sql = compiled.sql.replace(/\s+/g, " ");
  assert.match(sql, /"usage_counters_team_daily"/);
  assert.match(sql, /sum\("prompt_tokens"\)/);
  assert.match(sql, /sum\("error_count"\)/);
  assert.doesNotMatch(sql, /current_date/);
  const params = compiled.params.map(String);
  assert.ok(params.includes("2026-08-29"), params.join(","));
  assert.ok(params.includes("2026-09-04"), params.join(","));
});

test("workbench analytics hourly trend buckets request audits in the quota timezone", () => {
  const start = new Date("2026-09-03T16:00:00.000Z");
  const endExclusive = new Date("2026-09-04T16:00:00.000Z");
  const compiled = buildAnalyticsHourlyTrendQuery(start, endExclusive, "Asia/Shanghai").toSQL();
  const sql = compiled.sql.replace(/\s+/g, " ");
  assert.match(sql, /"request_audits"/);
  assert.match(sql, /at time zone/);
  assert.match(sql, /HH24:00/);
  assert.doesNotMatch(sql, /current_date/);
});

test("workbench analytics model ranks group client_model in the created_at window", () => {
  const compiled = buildAnalyticsByModelQuery(
    new Date("2026-09-03T16:00:00.000Z"),
    new Date("2026-09-04T16:00:00.000Z"),
  ).toSQL();
  const sql = compiled.sql.replace(/\s+/g, " ");
  assert.match(sql, /"client_model"/);
  assert.match(sql, /"request_audits"\."created_at"/);
});

test("platform analytics endpoint is super-admin only", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../src/routes/admin/overview.ts"),
    "utf8",
  );
  assert.match(source, /\/api\/admin\/overview\/analytics/);
  assert.match(source, /role !== "admin"/);
});
