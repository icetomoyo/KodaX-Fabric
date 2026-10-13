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
} = await import("../src/lib/glm-error-codes.js");
const { buildErrorLogListQuery, adminErrorLogRoutes } = await import(
  "../src/routes/admin/error-logs.js"
);

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
    extractUpstreamUsageCap({
      error: {
        code: "1310",
        message: "You have reached the 7-day usage limit. You can continue using it after 2026-09-21 15:29:59.",
      },
    })?.kind,
    "weekly",
  );
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
