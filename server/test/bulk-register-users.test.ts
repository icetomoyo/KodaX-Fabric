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

const { bulkRegisterAuditTargetId, planBulkRegisterUsers } = await import(
  "../src/lib/bulk-register-users.js"
);
const { adminUserRoutes } = await import("../src/routes/admin/users.js");

test("bulk register skips phones that already exist and rejects in-batch duplicates", () => {
  const duplicate = planBulkRegisterUsers(
    [
      { name: "张三", phone: "13800138000" },
      { name: "李四", phone: "13800138000" },
    ],
    [],
  );
  assert.deepEqual(duplicate, { kind: "batch_duplicate", duplicateIndexes: [1, 2] });

  const mixed = planBulkRegisterUsers(
    [
      { name: "张三", phone: "13800138000" },
      { name: "李四", phone: "13900139000" },
    ],
    ["13900139000"],
  );
  assert.deepEqual(mixed, {
    kind: "accepted",
    plan: {
      create: [{ name: "张三", phone: "13800138000" }],
      existingPhones: ["13900139000"],
    },
  });
});

test("bulk register audit target id stays within varchar(64) for a 200-person batch", () => {
  const ids = Array.from({ length: 200 }, (_, index) => 10_000_000 + index);
  const joined = ids.join(",");
  assert.ok(joined.length > 64);
  assert.ok(bulkRegisterAuditTargetId(ids).length <= 64);
  assert.equal(bulkRegisterAuditTargetId(ids), String(ids[0]));
});

test("super-admin bulk-register is name and phone only; single-user create stays forbidden", async () => {
  const app = Fastify();
  app.addHook("onRequest", async (req: { session?: Record<string, unknown>; employeeId?: number }) => {
    req.session = {
      sub: "1",
      role: "admin",
      phone: "13800000000",
      name: "Super",
      mustChangePassword: false,
      enterpriseId: 1,
    };
    req.employeeId = 1;
  });
  await app.register(adminUserRoutes);
  await app.ready();
  try {
    const create = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      payload: { name: "A", phone: "13800001111", password: "ChangeMe@123" },
    });
    assert.equal(create.statusCode, 403);

    const missing = await app.inject({
      method: "POST",
      url: "/api/admin/users/import",
      payload: { users: [] },
    });
    assert.equal(missing.statusCode, 400);

    const withPasswordOnlyShape = await app.inject({
      method: "POST",
      url: "/api/admin/users/import",
      payload: { users: [{ name: "A", phone: "1" }] },
    });
    assert.equal(withPasswordOnlyShape.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("enterprise console exposes bulk-register for super-admin only", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const enterprises = readFileSync(resolve(root, "web/src/views/admin/EnterprisesView.vue"), "utf8");
  assert.match(enterprises, /批量注册用户/);
  assert.match(enterprises, /canBulkRegisterUsers/);
  assert.match(enterprises, /auth\.isSuperAdmin/);
  assert.match(enterprises, /\/api\/admin\/users\/import/);
  assert.match(enterprises, /初始密码 Hz123456/);
  assert.doesNotMatch(enterprises, /password: .*(ChangeMe|Hz@)/);
});
