import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const { adminLogRoutes } = await import("../src/routes/admin/logs.js");
const { formatOpsAuditTargetLabel } = await import("../src/lib/ops-audit.js");

test("admin log routes expose list, detail, and context download", async () => {
  const app = Fastify();
  await app.register(adminLogRoutes);
  await app.ready();

  try {
    assert.equal(app.hasRoute({ method: "GET", url: "/api/admin/logs" }), true);
    assert.equal(app.hasRoute({ method: "GET", url: "/api/admin/logs/:requestId" }), true);
    assert.equal(app.hasRoute({ method: "GET", url: "/api/admin/logs/:requestId/context" }), true);
    const unauth = await app.inject({ method: "GET", url: "/api/admin/logs" });
    assert.equal(unauth.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("ops audit employee labels use name and phone, not id-only placeholders", () => {
  assert.equal(
    formatOpsAuditTargetLabel(["海致科技", "管理员", "13800000000"], "员工 #1"),
    "海致科技 · 管理员 · 13800000000",
  );
  assert.equal(formatOpsAuditTargetLabel([null, "", undefined], "员工 #1（已删除）"), "员工 #1（已删除）");
});

test("zonedInstant parses date or datetime boundaries in the quota timezone", async () => {
  const { zonedInstant, hasTimePart } = await import("../src/lib/quota-time.js");
  const tz = "Asia/Shanghai";
  const datetime = zonedInstant("2026-09-23 09:30:05", tz);
  assert.equal(datetime?.toISOString(), "2026-09-23T01:30:05.000Z");
  const dateOnly = zonedInstant("2026-09-23", tz);
  assert.equal(dateOnly?.toISOString(), "2026-09-22T16:00:00.000Z");
  const withT = zonedInstant("2026-09-23T09:30:05", tz);
  assert.equal(withT?.toISOString(), "2026-09-23T01:30:05.000Z");
  assert.equal(zonedInstant("2026-09-23 25:00:00", tz), null);
  assert.equal(zonedInstant("2026-02-30 10:00:00", tz), null);
  assert.equal(zonedInstant("not-a-date", tz), null);
  assert.equal(hasTimePart("2026-09-23 09:30:05"), true);
  assert.equal(hasTimePart("2026-09-23"), false);
});

test("me log filters accept second-precision boundaries and expose model facets", async () => {
  const { meRoutes } = await import("../src/routes/me.js");
  const app = Fastify();
  await app.register(meRoutes);
  await app.ready();
  try {
    assert.equal(app.hasRoute({ method: "GET", url: "/api/me/log-models" }), true);
    const unauth = await app.inject({ method: "GET", url: "/api/me/log-models" });
    assert.equal(unauth.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("admin log filters gain model facets and second-precision boundaries", async () => {
  const app = Fastify();
  await app.register(adminLogRoutes);
  await app.ready();
  try {
    assert.equal(app.hasRoute({ method: "GET", url: "/api/admin/log-models" }), true);
    const unauth = await app.inject({ method: "GET", url: "/api/admin/log-models" });
    assert.equal(unauth.statusCode, 401);
  } finally {
    await app.close();
  }
});
