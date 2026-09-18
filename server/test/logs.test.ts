import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const route = readFileSync(resolve(root, "src/routes/admin/ops-audit.ts"), "utf8");
  assert.match(route, /employees\.name/);
  assert.match(route, /employees\.phone/);
  assert.doesNotMatch(route, /员工 #\$\{row\.id\}/);
});
