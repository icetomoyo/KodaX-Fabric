import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";
process.env.QUOTA_TIMEZONE = "Asia/Shanghai";

const { adminModelPriceRoutes } = await import("../src/routes/admin/model-prices.js");
const {
  attachPricesToChannelModels,
  collectDiscoveredModels,
  groupDiscoveredModelsByChannel,
  parseDiscoveredModels,
} = await import("../src/lib/discovered-models.js");
const { meRoutes } = await import("../src/routes/me.js");
const { billedCacheReadTokens, extractCacheReadTokens } = await import(
  "../src/lib/usage-cache.js"
);
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

test("employee model catalog attaches unit prices to discovered models only", () => {
  const channels = attachPricesToChannelModels(
    [
      {
        id: 1,
        name: "GLM",
        code: "api",
        providerName: "智谱",
        providerCode: "glm",
        models: ["glm-4.6", "glm-5.3"],
      },
    ],
    [
      {
        model: "glm-4.6",
        promptPricePerMillion: "8.0000",
        completionPricePerMillion: "28.0000",
        cacheHitPricePerMillion: "2.0000",
      },
    ],
  );
  assert.deepEqual(channels[0]?.models, [
    {
      model: "glm-4.6",
      priced: true,
      promptPricePerMillion: "8.0000",
      completionPricePerMillion: "28.0000",
      cacheHitPricePerMillion: "2.0000",
    },
    {
      model: "glm-5.3",
      priced: false,
      promptPricePerMillion: null,
      completionPricePerMillion: null,
      cacheHitPricePerMillion: null,
    },
  ]);
});

test("employee model list is unauthenticated 401 and forbidden to admin/org_admin", async () => {
  const anonymous = Fastify();
  await anonymous.register(meRoutes);
  await anonymous.ready();
  try {
    const response = await anonymous.inject({ method: "GET", url: "/api/me/models" });
    assert.equal(response.statusCode, 401);
  } finally {
    await anonymous.close();
  }

  for (const session of [adminSession, orgAdminSession]) {
    const app = Fastify();
    app.addHook("onRequest", attachSession(session));
    await app.register(meRoutes);
    await app.ready();
    try {
      const response = await app.inject({ method: "GET", url: "/api/me/models" });
      assert.equal(response.statusCode, 403);
    } finally {
      await app.close();
    }
  }
});

test("channel model groups use only that channel's discovered Key list", () => {
  const grouped = groupDiscoveredModelsByChannel([
    {
      productLineId: 1,
      productLineName: "GLM",
      productLineCode: "api",
      providerName: "智谱",
      providerCode: "glm",
      meta: { discoveredModels: ["glm-4.6", "glm-5.3"] },
    },
    {
      productLineId: 1,
      productLineName: "GLM",
      productLineCode: "api",
      providerName: "智谱",
      providerCode: "glm",
      meta: { lastTest: { models: ["glm-5.3", "glm-5.3-flash"] } },
    },
    {
      productLineId: 2,
      productLineName: "GLM（国际版）",
      productLineCode: "api_intl",
      providerName: "智谱",
      providerCode: "glm",
      meta: null,
    },
  ]);
  assert.deepEqual(
    grouped.map((channel) => ({ id: channel.id, name: channel.name, models: channel.models })),
    [
      { id: 1, name: "GLM", models: ["glm-4.6", "glm-5.3", "glm-5.3-flash"] },
      { id: 2, name: "GLM（国际版）", models: [] },
    ],
  );
});

test("discovered models come from Key test metadata, not a typed catalog", () => {
  assert.deepEqual(
    parseDiscoveredModels({
      discoveredModels: [" glm-4.6 ", "qwen38-27b", "", "glm-4.6"],
      lastTest: { models: ["qwen38-27b", "extra-from-test"] },
    }),
    ["extra-from-test", "glm-4.6", "qwen38-27b"],
  );
  assert.deepEqual(
    collectDiscoveredModels([
      { discoveredModels: ["glm-4.6"] },
      { lastTest: { models: ["qwen38-27b"] } },
      null,
    ]),
    ["glm-4.6", "qwen38-27b"],
  );
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

test("cache hits are billed at cache-hit price, not full input price", () => {
  const priced = {
    promptPricePerMillion: "8",
    completionPricePerMillion: "28",
    cacheHitPricePerMillion: "2",
  };
  // 200k uncached * 8 + 800k cache * 2 + 100k out * 28 = 1.6 + 1.6 + 2.8 = 6.00
  assert.equal(computeCostYuan(1_000_000, 100_000, priced, 800_000), "6.00");
  // cache-hit price missing → cache portion is 0, not charged as input
  assert.equal(computeCostYuan(1_000_000, 0, { ...priced, cacheHitPricePerMillion: undefined }, 800_000), "1.60");
  assert.equal(computeCostYuan(1_000_000, 0, priced, 0), "8.00");
});

test("cache-read tokens come from Anthropic or OpenAI usage JSON", () => {
  assert.equal(extractCacheReadTokens({ cache_read_input_tokens: 5 }), 5);
  assert.equal(
    extractCacheReadTokens({ prompt_tokens_details: { cached_tokens: 7 } }),
    7,
  );
  assert.equal(
    extractCacheReadTokens({ input_tokens_details: { cached_tokens: 9 } }),
    9,
  );
  assert.equal(extractCacheReadTokens({ prompt_tokens: 10 }), null);
  assert.equal(billedCacheReadTokens(100, { cache_read_input_tokens: 250 }), 100);
  assert.equal(billedCacheReadTokens(100, { cache_read_input_tokens: 40 }), 40);
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
    { role: "org_admin", enterpriseId: 4, employeeId: 1 },
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
  assert.match(compiledSql, /coalesce\("model_prices"\."cache_hit_price_per_million", 0\)/);
  assert.match(compiledSql, /cache_read_input_tokens/);
  assert.match(compiledSql, /prompt_tokens_details/);
  assert.equal(
    compiled.params.some((value) => value instanceof Date),
    false,
    "cost window must bind ISO strings; Date params throw in postgres.js",
  );
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
  assert.match(dailySql, /group by 1/i);
  assert.match(dailySql, /\/ 1000000/);
  assert.match(dailySql, /coalesce\(sum\(/);
  assert.equal(daily.params.includes(8), true);
  assert.equal(
    daily.params.some((value) => value instanceof Date),
    false,
    "usage window must bind ISO strings; Date params throw in postgres.js",
  );

  const byModel = buildTeamUsageByModelQuery(range).toSQL();
  const byModelSql = byModel.sql.replace(/\s+/g, " ");
  assert.match(byModelSql, /"model_prices"\."id" is not null/);
  assert.match(byModelSql, /coalesce\("model_prices"\."prompt_price_per_million", 0\)/);
  assert.match(byModelSql, /coalesce\("model_prices"\."cache_hit_price_per_million", 0\)/);
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
  assert.match(compiledSql, /coalesce\("model_prices"\."cache_hit_price_per_million", 0\)/);
  assert.match(compiledSql, /coalesce\("request_audits"\."prompt_tokens", 0\)/);
  assert.match(compiledSql, /cache_read_input_tokens/);
  assert.match(compiledSql, /coalesce\(sum\(/);
});
