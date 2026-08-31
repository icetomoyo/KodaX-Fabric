import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";
process.env.QUOTA_TIMEZONE = "Asia/Shanghai";

const { adminModelPriceRoutes, toCatalogModelEntry } = await import(
  "../src/routes/admin/model-prices.js"
);
const {
  collectCatalogModels,
  collectDiscoveredModels,
  groupDiscoveredModelsByChannel,
  isGlmClientModelAllowed,
  lastUsedAtForCatalogModel,
  parseDiscoveredModels,
  toCatalogModelName,
} = await import("../src/lib/discovered-models.js");
const { meRoutes } = await import("../src/routes/me.js");
const { billedCacheReadTokens, extractCacheReadTokens } = await import(
  "../src/lib/usage-cache.js"
);
const { adminTeamRoutes, buildTeamListQuery } = await import("../src/routes/admin/teams.js");
const {
  buildTeamUsageByModelQuery,
  buildTeamUsageDailyQuery,
  fillDailyTeamUsage,
  formatYuan,
  mapModelUsageRows,
} = await import("../src/lib/model-cost.js");
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

test("unauthenticated model catalog calls return 401", async () => {
  const list = await injectPriceRoutes(null, { method: "GET", url: "/api/admin/model-prices" });
  assert.equal(list.statusCode, 401);
});

test("org_admin and team_admin cannot list the admin model catalog", async () => {
  for (const session of [orgAdminSession, teamAdminSession]) {
    const list = await injectPriceRoutes(session, { method: "GET", url: "/api/admin/model-prices" });
    assert.equal(list.statusCode, 403);
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
    {
      productLineId: 3,
      productLineName: "公司qwen3.8-27b",
      productLineCode: "c_custom",
      providerName: "自定义",
      providerCode: "custom",
      meta: { discoveredModels: ["qwen38-27b"] },
    },
  ]);
  assert.deepEqual(
    grouped.map((channel) => ({ id: channel.id, name: channel.name, models: channel.models })),
    [
      { id: 3, name: "公司qwen3.8-27b", models: ["qwen38-27b"] },
      { id: 1, name: "GLM", models: ["glm-5.3", "glm-5.3-flash"] },
      { id: 2, name: "GLM（国际版）", models: [] },
    ],
  );
});

test("Zhipu coding-plan aliases collapse to glm-5.3 and glm-5.3-flash", () => {
  assert.equal(toCatalogModelName("glm-4.5"), "glm-5.3");
  assert.equal(toCatalogModelName("glm-4.5-air"), "glm-5.3");
  assert.equal(toCatalogModelName("glm-4.6"), "glm-5.3");
  assert.equal(toCatalogModelName("glm-5"), "glm-5.3");
  assert.equal(toCatalogModelName("glm-5.1"), "glm-5.3");
  assert.equal(toCatalogModelName("glm-5.2"), "glm-5.3");
  assert.equal(toCatalogModelName("GLM-5.3"), "glm-5.3");

  assert.equal(toCatalogModelName("glm-4.7"), "glm-5.3-flash");
  assert.equal(toCatalogModelName("glm-4.7-flash"), "glm-5.3-flash");
  assert.equal(toCatalogModelName("glm-4.7-flashx"), "glm-5.3-flash");
  assert.equal(toCatalogModelName("glm-5-turbo"), "glm-5.3-flash");
  assert.equal(toCatalogModelName("glm-5.3-flash"), "glm-5.3-flash");

  assert.equal(toCatalogModelName("glm-ocr"), "glm-ocr");
  assert.equal(toCatalogModelName("qwen38-27b"), "qwen38-27b");
});

test("Zhipu relay whitelist accepts only glm-5.3 and glm-5.3-flash", () => {
  assert.equal(isGlmClientModelAllowed("glm-5.3"), true);
  assert.equal(isGlmClientModelAllowed("GLM-5.3-FLASH"), true);
  assert.equal(isGlmClientModelAllowed(" glm-5.3 "), true);
  assert.equal(isGlmClientModelAllowed("glm-4.6"), false);
  assert.equal(isGlmClientModelAllowed("glm-5.2"), false);
  assert.equal(isGlmClientModelAllowed("glm-4.7-flash"), false);
  assert.equal(isGlmClientModelAllowed("qwen38-27b"), false);
});

test("catalog rows attach built-in GLM credit rates and leave custom models unmetered", () => {
  const glm = toCatalogModelEntry("glm-5.3", new Date("2026-08-30T00:00:00.000Z"));
  assert.equal(glm.seenInLast30Days, true);
  assert.deepEqual(glm.creditRate, {
    promptCreditsPer10k: "6.9",
    cacheHitCreditsPer10k: "1.7",
    completionCreditsPer10k: "24",
  });

  const flash = toCatalogModelEntry("glm-5.3-flash", null);
  assert.equal(flash.seenInLast30Days, false);
  assert.deepEqual(flash.creditRate, {
    promptCreditsPer10k: "2.3",
    cacheHitCreditsPer10k: "0.56",
    completionCreditsPer10k: "8",
  });

  const custom = toCatalogModelEntry("qwen38-27b", null);
  assert.equal(custom.creditRate, null);
});

test("pricing catalog only keeps current Zhipu coding-plan models", () => {
  assert.deepEqual(
    collectCatalogModels([
      {
        discoveredModels: [
          "glm-4.5",
          "glm-4.6",
          "glm-4.7",
          "glm-5-turbo",
          "glm-5.3",
          "glm-5.3-flash",
          "qwen38-27b",
        ],
      },
    ]),
    ["glm-5.3", "glm-5.3-flash", "qwen38-27b"],
  );
});

test("catalog last-used rolls up historical GLM aliases", () => {
  const older = new Date("2026-08-20T00:00:00.000Z");
  const newer = new Date("2026-08-30T00:00:00.000Z");
  const usedByName = new Map<string, Date | null>([
    ["glm-4.6", older],
    ["glm-5.2", newer],
    ["glm-4.7-flash", older],
    ["qwen38-27b", newer],
  ]);
  assert.equal(lastUsedAtForCatalogModel("glm-5.3", usedByName)?.toISOString(), newer.toISOString());
  assert.equal(lastUsedAtForCatalogModel("glm-5.3-flash", usedByName)?.toISOString(), older.toISOString());
  assert.equal(lastUsedAtForCatalogModel("qwen38-27b", usedByName)?.toISOString(), newer.toISOString());
  assert.equal(lastUsedAtForCatalogModel("glm-5", usedByName), null);
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

test("model usage rows keep token totals", () => {
  const mixed = mapModelUsageRows([
    { model: "gpt-4o", totalTokens: 1_500_000 },
    { model: "new-model", totalTokens: 800_000 },
  ]);
  assert.deepEqual(mixed, [
    { model: "gpt-4o", totalTokens: 1_500_000 },
    { model: "new-model", totalTokens: 800_000 },
  ]);
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

test("daily usage fill keeps token totals", () => {
  const daily = fillDailyTeamUsage("2026-08-22", "2026-08-23", [
    { day: "2026-08-23", totalTokens: "1000", requestCount: "2" },
  ]);
  assert.deepEqual(daily, [
    { day: "2026-08-22", totalTokens: 0, requestCount: 0 },
    { day: "2026-08-23", totalTokens: 1000, requestCount: 2 },
  ]);
});

test("team list SQL sums token counters without model prices", () => {
  const scope = resolveTeamListScope(
    { role: "org_admin", enterpriseId: 4, employeeId: 1 },
    undefined,
    [],
  );
  assert.equal("forbidden" in scope, false);
  if ("forbidden" in scope) return;
  const compiled = buildTeamListQuery(scope).toSQL();
  const compiledSql = compiled.sql.replace(/\s+/g, " ");
  assert.match(compiledSql, /usage_counters_team_daily/);
  assert.doesNotMatch(compiledSql, /model_prices/);
  assert.doesNotMatch(compiledSql, /prompt_price_per_million/);
});

test("team usage SQL aggregates tokens by day and model", () => {
  const range = {
    teamId: 8,
    start: new Date("2026-08-01T16:00:00.000Z"),
    endExclusive: new Date("2026-08-23T16:00:00.000Z"),
    timeZone: "Asia/Shanghai",
  };
  const daily = buildTeamUsageDailyQuery(range).toSQL();
  const dailySql = daily.sql.replace(/\s+/g, " ");
  assert.match(dailySql, /from "request_audits"/);
  assert.doesNotMatch(dailySql, /model_prices/);
  assert.match(dailySql, /at time zone/);
  assert.match(dailySql, /group by 1/i);
  assert.match(dailySql, /coalesce\(sum\(/);
  assert.equal(daily.params.includes(8), true);
  assert.equal(
    daily.params.some((value) => value instanceof Date),
    false,
    "usage window must bind ISO strings; Date params throw in postgres.js",
  );

  const byModel = buildTeamUsageByModelQuery(range).toSQL();
  const byModelSql = byModel.sql.replace(/\s+/g, " ");
  assert.doesNotMatch(byModelSql, /model_prices/);
  assert.match(byModelSql, /group by "request_audits"\."client_model"/);
});
