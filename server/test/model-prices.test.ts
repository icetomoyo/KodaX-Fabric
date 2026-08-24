import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";
process.env.QUOTA_TIMEZONE = "Asia/Shanghai";

const { adminModelPriceRoutes } = await import("../src/routes/admin/model-prices.js");
const { adminTeamRoutes, buildTeamListQuery } = await import("../src/routes/admin/teams.js");
const {
  buildTeamUsageByModelQuery,
  buildTeamUsageDailyQuery,
  computeCostYuan,
  fillDailyTeamUsage,
  formatYuan,
  mapModelUsageRows,
  requestCostYuanExpr,
  sumRequestCostYuanSql,
} = await import("../src/lib/model-cost.js");
const { db } = await import("../src/db/client.js");
const { requestAudits } = await import("../src/db/schema/index.js");
const { resolveTeamListScope } = await import("../src/lib/org.js");

const adminSession = {
  sub: "1",
  role: "admin" as const,
  phone: "13800000001",
  name: "Admin",
  mustChangePassword: false,
  enterpriseId: null as number | null,
};

const orgAdminSession = {
  ...adminSession,
  sub: "9",
  role: "org_admin" as const,
  name: "OrgAdmin",
  enterpriseId: 3,
};

const teamAdminSession = {
  ...adminSession,
  sub: "11",
  role: "team_admin" as const,
  name: "TeamAdmin",
  enterpriseId: 3,
};

function attachSession(session: typeof adminSession) {
  return async (req: { session?: typeof adminSession; employeeId?: number }) => {
    req.session = session;
    req.employeeId = Number(session.sub);
  };
}

async function injectPriceRoutes(session: typeof adminSession | null, request: {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  payload?: Record<string, unknown>;
}) {
  const app = Fastify();
  if (session) app.addHook("onRequest", attachSession(session));
  await app.register(adminModelPriceRoutes);
  await app.ready();
  try {
    return await app.inject(request);
  } finally {
    await app.close();
  }
}

test("unauthenticated model-price calls return 401", async () => {
  const list = await injectPriceRoutes(null, { method: "GET", url: "/api/admin/model-prices" });
  const create = await injectPriceRoutes(null, {
    method: "POST",
    url: "/api/admin/model-prices",
    payload: { model: "gpt-4o", promptPricePerMillion: "1", completionPricePerMillion: "2" },
  });
  const patch = await injectPriceRoutes(null, {
    method: "PATCH",
    url: "/api/admin/model-prices/1",
    payload: { promptPricePerMillion: "3" },
  });
  const del = await injectPriceRoutes(null, { method: "DELETE", url: "/api/admin/model-prices/1" });
  assert.equal(list.statusCode, 401);
  assert.equal(create.statusCode, 401);
  assert.equal(patch.statusCode, 401);
  assert.equal(del.statusCode, 401);
});

test("org_admin and team_admin cannot mutate or list model prices", async () => {
  for (const session of [orgAdminSession, teamAdminSession]) {
    const list = await injectPriceRoutes(session, { method: "GET", url: "/api/admin/model-prices" });
    const create = await injectPriceRoutes(session, {
      method: "POST",
      url: "/api/admin/model-prices",
      payload: { model: "gpt-4o", promptPricePerMillion: "1", completionPricePerMillion: "2" },
    });
    const patch = await injectPriceRoutes(session, {
      method: "PATCH",
      url: "/api/admin/model-prices/1",
      payload: { promptPricePerMillion: "3" },
    });
    const del = await injectPriceRoutes(session, { method: "DELETE", url: "/api/admin/model-prices/1" });
    assert.equal(list.statusCode, 403);
    assert.equal(create.statusCode, 403);
    assert.equal(patch.statusCode, 403);
    assert.equal(del.statusCode, 403);
  }
});

test("unauthenticated team usage calls return 401", async () => {
  const app = Fastify();
  await app.register(adminTeamRoutes);
  await app.ready();
  try {
    const usage = await app.inject({ method: "GET", url: "/api/admin/teams/1/usage" });
    assert.equal(usage.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("formatYuan keeps two decimals without exposing raw floats", () => {
  assert.equal(formatYuan("7.5"), "7.50");
  assert.equal(formatYuan("1.235"), "1.24");
  assert.equal(formatYuan("0"), "0.00");
  assert.equal(formatYuan(null), "0.00");
  assert.equal(formatYuan("12.345000"), "12.35");
});

test("priced usage converts tokens to yuan; unpriced models stay 0", () => {
  const priced = { promptPricePerMillion: "2.5000", completionPricePerMillion: "10.0000" };
  assert.equal(computeCostYuan(1_000_000, 500_000, priced), "7.50");
  assert.equal(computeCostYuan(200_000, 0, priced), "0.50");
  assert.equal(computeCostYuan(1_000_000, 1_000_000, null), "0.00");
  assert.equal(computeCostYuan(0, 0, priced), "0.00");

  const mixed = mapModelUsageRows([
    { model: "gpt-4o", totalTokens: 1_500_000, costYuan: "7.50", priced: true },
    { model: "new-model", totalTokens: 800_000, costYuan: "3.21", priced: false },
  ]);
  assert.deepEqual(mixed, [
    { model: "gpt-4o", totalTokens: 1_500_000, costYuan: "7.50", priced: true },
    { model: "new-model", totalTokens: 800_000, costYuan: "0.00", priced: false },
  ]);
});

test("daily usage fill keeps costYuan as a 2-decimal string", () => {
  const daily = fillDailyTeamUsage("2026-08-22", "2026-08-23", [
    { day: "2026-08-23", totalTokens: "1000", requestCount: "2", costYuan: "1.2" },
  ]);
  assert.deepEqual(daily, [
    { day: "2026-08-22", totalTokens: 0, requestCount: 0, costYuan: "0.00" },
    { day: "2026-08-23", totalTokens: 1000, requestCount: 2, costYuan: "1.20" },
  ]);
});

test("team list SQL folds request_audits cost with coalesce-0 for missing prices", () => {
  const scope = resolveTeamListScope(
    { role: "admin", enterpriseId: null, employeeId: 1 },
    undefined,
    [],
  );
  assert.equal("forbidden" in scope, false);
  if ("forbidden" in scope) return;
  const compiled = buildTeamListQuery(scope).toSQL();
  const compiledSql = compiled.sql.replace(/\s+/g, " ");
  assert.match(compiledSql, /today_cost_yuan|prompt_price_per_million|model_prices/i);
  assert.match(compiledSql, /request_audits/);
  assert.match(compiledSql, /model_prices/);
  assert.match(compiledSql, /\/ 1000000/);
  assert.match(compiledSql, /coalesce\("model_prices"\."prompt_price_per_million", 0\)/);
  assert.match(compiledSql, /coalesce\("model_prices"\."completion_price_per_million", 0\)/);
});

test("team usage SQL aggregates cost in numeric and marks unpriced models", () => {
  const range = {
    teamId: 8,
    start: new Date("2026-08-01T16:00:00.000Z"),
    endExclusive: new Date("2026-08-23T16:00:00.000Z"),
    timeZone: "Asia/Shanghai",
  };
  const daily = buildTeamUsageDailyQuery(range).toSQL();
  const dailySql = daily.sql.replace(/\s+/g, " ");
  assert.match(dailySql, /from "request_audits"/);
  assert.match(dailySql, /left join "model_prices"/);
  assert.match(dailySql, /at time zone/);
  assert.match(dailySql, /\/ 1000000/);
  assert.match(dailySql, /coalesce\(sum\(/);
  assert.equal(daily.params.includes(8), true);

  const byModel = buildTeamUsageByModelQuery(range).toSQL();
  const byModelSql = byModel.sql.replace(/\s+/g, " ");
  assert.match(byModelSql, /"model_prices"\."id" is not null/);
  assert.match(byModelSql, /coalesce\("model_prices"\."prompt_price_per_million", 0\)/);
  assert.match(byModelSql, /group by "request_audits"\."client_model"/);
});

test("cost SQL fragment zeros missing prices before summing", () => {
  const compiled = db
    .select({
      cost: requestCostYuanExpr,
      total: sumRequestCostYuanSql,
    })
    .from(requestAudits)
    .toSQL();
  const compiledSql = compiled.sql.replace(/\s+/g, " ");
  assert.match(compiledSql, /coalesce\("model_prices"\."prompt_price_per_million", 0\)/);
  assert.match(compiledSql, /coalesce\("request_audits"\."prompt_tokens", 0\)/);
  assert.match(compiledSql, /coalesce\(sum\(/);
});
