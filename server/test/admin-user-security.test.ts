import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const { adminUserRoutes } = await import("../src/routes/admin/users.js");

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
