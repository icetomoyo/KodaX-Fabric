import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const {
  adminUserRoutes,
  aggregateAdminUserListRows,
  buildAdminUserCountQuery,
  buildAdminUserIdPageQuery,
  buildAdminUserListQuery,
  buildEmployeeLogsQuery,
} = await import(
  "../src/routes/admin/users.js"
);

test("org-admin employee logs select call records without bodies or API keys", () => {
  const compiledSql = buildEmployeeLogsQuery({
    employeeId: 12,
    start: new Date("2026-08-01T00:00:00.000Z"),
    endExclusive: new Date("2026-08-02T00:00:00.000Z"),
    limit: 20,
    offset: 0,
  })
    .toSQL()
    .sql.replace(/\s+/g, " ");

  assert.match(compiledSql, /from "request_audits"/);
  assert.match(compiledSql, /"employee_id"/);
  assert.match(compiledSql, /"client_model"/);
  assert.match(compiledSql, /"total_tokens"/);
  assert.match(compiledSql, /"cache_read_tokens"/);
  assert.doesNotMatch(compiledSql, /request_audit_bodies/);
  assert.doesNotMatch(compiledSql, /employee_api_keys/);
  assert.doesNotMatch(compiledSql, /key_encrypted/);
});

test("admin user list selects employee data without API-key joins", () => {
  const compiledSql = buildAdminUserListQuery({ limit: 50, offset: 0 })
    .toSQL()
    .sql.replace(/\s+/g, " ");

  assert.match(compiledSql, /from "employees"/);
  assert.match(compiledSql, /left join "team_members"/);
  assert.match(compiledSql, /left join "teams"/);
  assert.match(compiledSql, /left join "departments"/);
  assert.doesNotMatch(compiledSql, /employee_api_keys/);
  assert.doesNotMatch(compiledSql, /active_api_key_count/);
});

test("admin user count and id page collapse memberships to one employee", () => {
  const countSql = buildAdminUserCountQuery({ enterpriseId: 3 })
    .toSQL()
    .sql.replace(/\s+/g, " ");
  assert.match(countSql, /count\(distinct/);
  assert.doesNotMatch(countSql, /employee_api_keys/);

  const pageSql = buildAdminUserIdPageQuery({
    enterpriseId: 3,
    limit: 10,
    offset: 0,
  })
    .toSQL();
  const compiled = pageSql.sql.replace(/\s+/g, " ");
  assert.match(compiled, /select distinct/);
  assert.equal(pageSql.params.includes(3), true);
  assert.equal(pageSql.params.includes(10), true);
});

test("admin user list aggregation keeps one row and joins department names", () => {
  const rows = aggregateAdminUserListRows([
    {
      id: 9,
      name: "邓华亮",
      phone: "13800000009",
      dept: null,
      role: "employee",
      status: "active",
      enterpriseId: 3,
      lastLoginAt: null,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      teamId: 101,
      teamName: "默认团队",
      teamRole: "member",
      departmentId: 8,
      departmentName: "产品技术部",
      departmentIsDefault: false,
    },
    {
      id: 9,
      name: "邓华亮",
      phone: "13800000009",
      dept: null,
      role: "employee",
      status: "active",
      enterpriseId: 3,
      lastLoginAt: null,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      teamId: 102,
      teamName: "默认团队",
      teamRole: "member",
      departmentId: 18,
      departmentName: "平台组",
      departmentIsDefault: false,
    },
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]?.teamIds, [101, 102]);
  assert.equal(rows[0]?.departmentName, "产品技术部、平台组");
  assert.equal(rows[0]?.teamName, "产品技术部、平台组");
});

test("admin routes do not expose employee API-key metadata or plaintext", async () => {
  const app = Fastify();
  await app.register(adminUserRoutes);
  await app.ready();

  try {
    assert.equal(
      app.hasRoute({ method: "GET", url: "/api/admin/users/:id/api-keys" }),
      false,
    );
    assert.equal(
      app.hasRoute({
        method: "POST",
        url: "/api/admin/users/:id/api-keys/:keyId/reveal",
      }),
      false,
    );
    assert.equal(app.hasRoute({ method: "GET", url: "/api/admin/users" }), true);
    assert.equal(app.hasRoute({ method: "GET", url: "/api/admin/users/:id/logs" }), true);
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      payload: { name: "A", phone: "13800001111", password: "ChangeMe@123" },
    });
    assert.equal(created.statusCode, 401);
  } finally {
    await app.close();
  }
});
