import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const {
  extractUpstreamBusinessError,
  extractUpstreamUsageCap,
  formatUpstreamVendorError,
  lookupGlmErrorCatalog,
  resolveLoggedError,
  GLM_ERROR_CATALOG,
  GLM_ERROR_CODE_DOC_URL,
} = await import("../src/lib/glm-error-codes.js");
const { buildErrorLogListQuery, adminErrorLogRoutes } = await import(
  "../src/routes/admin/error-logs.js"
);

test("智谱目录未实测改写的条目仍是官方 FAQ 原文", () => {
  const entry = lookupGlmErrorCatalog("1001");
  assert.deepEqual(entry, {
    code: "1001",
    httpStatus: 401,
    message: "Header 中未收到 Authentication 参数，无法进行身份验证",
  });
  assert.equal(
    lookupGlmErrorCatalog("1309")?.message,
    "您的 GLM Coding Plan 套餐已到期，暂无法使用，前往官方续订后即可恢复 https://bigmodel.cn/claude-code",
  );
  assert.equal(
    lookupGlmErrorCatalog("1313")?.message,
    "您的账户当前使用模式不符合公平使用策略，请求频率已受到限制。详情请参阅《条款与协议-订阅及自动续费协议》，如需恢复请前往个人中心-编程套餐总览-顶部申请解除限制",
  );
  assert.equal(GLM_ERROR_CATALOG[0]?.code, null);
  assert.equal(GLM_ERROR_CATALOG[0]?.httpStatus, 500);
  assert.equal(GLM_ERROR_CATALOG[0]?.message, "内部错误");
  assert.equal(GLM_ERROR_CODE_DOC_URL, "https://docs.bigmodel.cn/cn/faq/api-code");
});

test("智谱 1302 / 1113 / 1261 分别对应官方 HTTP 与错误信息原文", () => {
  assert.equal(lookupGlmErrorCatalog("1302")?.httpStatus, 429);
  assert.equal(lookupGlmErrorCatalog("1113")?.message, "您的账户已欠费，请充值后重试");
  assert.equal(lookupGlmErrorCatalog("1261")?.message, "Prompt 超长");
});

test("智谱 1308 / 1310 目录与 coding-plan 线上原文对齐", () => {
  assert.equal(
    lookupGlmErrorCatalog("1308")?.message,
    "已达到 5 小时使用上限，${next_flush_time} 后可继续使用。如需超限额按量付费使用，可联系管理员开启超额按量付费。",
  );
  assert.equal(
    lookupGlmErrorCatalog("1310")?.message,
    "已达到 7 天使用上限，${next_flush_time} 后可继续使用。如需超限额按量付费使用，可联系管理员开启超额按量付费。",
  );
  // 文档 1317 仍是「7 天 + 无法超额按量」变体，不是线上周额度码。
  assert.match(lookupGlmErrorCatalog("1317")?.message ?? "", /主账号余额不足/);
});

test("formatUpstreamVendorError keeps the channel error code and message", () => {
  assert.equal(
    formatUpstreamVendorError(429, JSON.stringify({
      error: { code: "1113", message: "余额不足或无可用资源包,请充值。" },
    })),
    "[1113] 余额不足或无可用资源包,请充值。",
  );
  assert.equal(
    formatUpstreamVendorError(429, JSON.stringify({
      error: {
        code: "1310",
        message: "已达到 7 天使用上限，2026-09-21 17:49:49 后可继续使用。",
      },
    })),
    "[1310] 已达到 7 天使用上限，2026-09-21 17:49:49 后可继续使用。",
  );
});

test("extractUpstreamUsageCap treats 1308 / 1310 codes as usage caps without 使用上限", () => {
  assert.deepEqual(extractUpstreamUsageCap({ error: { code: "1310", message: "weekly limit" } }), {
    kind: "weekly",
    resetAt: null,
  });
  assert.equal(
    extractUpstreamUsageCap({ error: { code: "1308", message: "cap" } })?.kind,
    "five_hour",
  );
  assert.equal(
    extractUpstreamUsageCap({ error: { code: "1317", message: "doc 7-day variant" } })?.kind,
    "weekly",
  );
});

test("unknown error codes have no catalog entry", () => {
  assert.equal(lookupGlmErrorCatalog("not-a-code"), null);
  assert.equal(lookupGlmErrorCatalog(null), null);
});

test("extracts GLM envelope business code from error.code", () => {
  assert.deepEqual(
    extractUpstreamBusinessError({
      error: { code: "1001", message: "Header 中未收到 Authentication 参数，无法进行身份验证" },
    }),
    {
      code: "1001",
      message: "Header 中未收到 Authentication 参数，无法进行身份验证",
    },
  );
  assert.equal(extractUpstreamBusinessError({ error: { code: 1302, message: "rate" } })?.code, "1302");
});

test("logged error keeps GLM 业务错误码 / HTTP / 错误信息原文", () => {
  const resolved = resolveLoggedError({
    httpStatus: 502,
    upstreamStatus: 401,
    errorCode: "upstream_auth_error",
    errorMessage: "上游凭证鉴权失败（HTTP 401）",
    upstreamPayload: { error: { code: "1000", message: "身份验证失败" } },
  });
  assert.deepEqual(resolved, {
    code: "1000",
    httpStatus: 401,
    message: "身份验证失败",
  });
});

test("unauthenticated error-log calls return 401", async () => {
  const app = Fastify();
  await app.register(adminErrorLogRoutes);
  await app.ready();
  try {
    const anon = await app.inject({ method: "GET", url: "/api/admin/error-logs" });
    assert.equal(anon.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("org_admin cannot list error logs", async () => {
  const app = Fastify();
  app.addHook("onRequest", async (req) => {
    req.session = {
      sub: "9",
      role: "org_admin",
      phone: "13800000009",
      name: "OrgAdmin",
      mustChangePassword: false,
      enterpriseId: 3,
    };
    req.employeeId = 9;
  });
  await app.register(adminErrorLogRoutes);
  await app.ready();
  try {
    const orgAdmin = await app.inject({ method: "GET", url: "/api/admin/error-logs" });
    assert.equal(orgAdmin.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("employees cannot list error logs", async () => {
  const app = Fastify();
  app.addHook("onRequest", async (req) => {
    req.session = {
      sub: "2",
      role: "employee",
      phone: "13800000002",
      name: "Emp",
      mustChangePassword: false,
      enterpriseId: 1,
    };
    req.employeeId = 2;
  });
  await app.register(adminErrorLogRoutes);
  await app.ready();
  try {
    const employee = await app.inject({ method: "GET", url: "/api/admin/error-logs" });
    assert.equal(employee.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("error-log SQL includes employee identity and scopes org/team/request", () => {
  const superSql = buildErrorLogListQuery({
    limit: 10,
    offset: 0,
  }).toSQL().sql.replace(/\s+/g, " ");
  assert.match(superSql, /from "request_error_logs"/);
  assert.match(superSql, /"employees"\."name"/);

  const orgSql = buildErrorLogListQuery({
    limit: 10,
    offset: 0,
    enterpriseId: 9,
    employeeId: 12,
    requestId: "threq_abcdefgh",
  }).toSQL();
  const orgCompiled = orgSql.sql.replace(/\s+/g, " ");
  assert.match(orgCompiled, /"employees"\."name"/);
  assert.match(orgCompiled, /"employee_id"/);
  assert.match(orgCompiled, /"request_id"/);
  assert.equal(orgSql.params.includes(9), true);
  assert.equal(orgSql.params.includes(12), true);
  assert.equal(orgSql.params.includes("threq_abcdefgh"), true);

  const teamSql = buildErrorLogListQuery({
    limit: 10,
    offset: 0,
    teamIds: [3, 5],
  }).toSQL();
  const compiled = teamSql.sql.replace(/\s+/g, " ");
  assert.match(compiled, /"team_id"/);
  assert.equal(teamSql.params.includes(3), true);
  assert.equal(teamSql.params.includes(5), true);
});

test("error-log routes expose list and detail", async () => {
  const app = Fastify();
  await app.register(adminErrorLogRoutes);
  await app.ready();
  try {
    assert.equal(app.hasRoute({ method: "GET", url: "/api/admin/error-logs" }), true);
    assert.equal(app.hasRoute({ method: "GET", url: "/api/admin/error-logs/:requestId" }), true);
    const unauth = await app.inject({
      method: "GET",
      url: "/api/admin/error-logs/threq_abcdefgh",
    });
    assert.equal(unauth.statusCode, 401);
  } finally {
    await app.close();
  }
});
