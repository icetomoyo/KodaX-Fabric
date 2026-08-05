import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const { adminUserRoutes, buildAdminUserListQuery } = await import(
  "../src/routes/admin/users.js"
);

test("admin user list selects employee data without API-key joins", () => {
  const compiledSql = buildAdminUserListQuery({ limit: 50, offset: 0 })
    .toSQL()
    .sql.replace(/\s+/g, " ");

  assert.match(compiledSql, /from "employees"/);
  assert.doesNotMatch(compiledSql, /employee_api_keys/);
  assert.doesNotMatch(compiledSql, /active_api_key_count/);
  assert.doesNotMatch(compiledSql, /\bjoin\b/);
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
  } finally {
    await app.close();
  }
});
