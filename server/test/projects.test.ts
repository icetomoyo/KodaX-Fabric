import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Fastify from "fastify";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const { adminProjectRoutes } = await import("../src/routes/admin/projects.js");

test("unauthenticated project calls return 401", async () => {
  const app = Fastify();
  await app.register(adminProjectRoutes);
  await app.ready();
  try {
    const list = await app.inject({ method: "GET", url: "/api/admin/projects" });
    const create = await app.inject({
      method: "POST",
      url: "/api/admin/projects",
      payload: { teamId: 1, name: "Demo" },
    });
    assert.equal(list.statusCode, 401);
    assert.equal(create.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("org_admin cannot call team-admin project APIs", async () => {
  const app = Fastify();
  app.addHook("onRequest", async (req: { session?: Record<string, unknown>; employeeId?: number }) => {
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
  await app.register(adminProjectRoutes);
  await app.ready();
  try {
    const list = await app.inject({ method: "GET", url: "/api/admin/projects" });
    assert.equal(list.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("project workspace is a three-pane team-admin page", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const view = readFileSync(resolve(root, "web/src/views/admin/ProjectsView.vue"), "utf8");
  assert.match(view, /项目详情/);
  assert.match(view, /项目成员/);
  assert.match(view, /员工可以同时加入多个项目/);
  assert.match(view, /用量和套餐目前仍记在团队上/);
});
