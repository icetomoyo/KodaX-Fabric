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

const { adminEnterpriseRoutes, buildEnterpriseListQuery } = await import(
  "../src/routes/admin/enterprises.js"
);
const { meRoutes } = await import("../src/routes/me.js");
const { adminUserRoutes, buildAdminUserListQuery } = await import(
  "../src/routes/admin/users.js"
);
const { adminCredentialRoutes } = await import("../src/routes/admin/credentials.js");
const { resolveUserListScope } = await import("../src/lib/enterprise.js");

const orgAdminSession = {
  sub: "9",
  role: "org_admin" as const,
  phone: "13800000009",
  name: "OrgAdmin",
  mustChangePassword: false,
  enterpriseId: 3,
};

function attachSession(session: typeof orgAdminSession) {
  return async (req: { session?: typeof orgAdminSession; employeeId?: number }) => {
    req.session = session;
    req.employeeId = Number(session.sub);
  };
}

test("unauthenticated enterprise and scoped-user calls return 401", async () => {
  const app = Fastify();
  await app.register(adminEnterpriseRoutes);
  await app.register(adminUserRoutes);
  await app.register(meRoutes);
  await app.ready();

  try {
    const joinEnterprise = await app.inject({
      method: "POST",
      url: "/api/me/join-enterprise",
      payload: { code: "EAAAAAAAA" },
    });
    assert.equal(joinEnterprise.statusCode, 401);
    const listEnterprises = await app.inject({ method: "GET", url: "/api/admin/enterprises" });
    const createEnterprise = await app.inject({
      method: "POST",
      url: "/api/admin/enterprises",
      payload: { name: "X" },
    });
    const listUsers = await app.inject({ method: "GET", url: "/api/admin/users" });
    const createUser = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      payload: { name: "A", phone: "13800001111", password: "ChangeMe@123" },
    });

    assert.equal(listEnterprises.statusCode, 401);
    assert.equal(createEnterprise.statusCode, 401);
    assert.equal(listUsers.statusCode, 401);
    assert.equal(createUser.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("org_admin cannot create or list-all enterprises and cannot call super-admin platform APIs", async () => {
  const app = Fastify();
  app.addHook("onRequest", attachSession(orgAdminSession));
  await app.register(adminEnterpriseRoutes);
  await app.register(adminUserRoutes);
  await app.register(adminCredentialRoutes);
  await app.ready();

  try {
    const listEnterprises = await app.inject({ method: "GET", url: "/api/admin/enterprises" });
    const createEnterprise = await app.inject({
      method: "POST",
      url: "/api/admin/enterprises",
      payload: { name: "Forbidden Corp" },
    });
    const disableEnterprise = await app.inject({
      method: "PATCH",
      url: "/api/admin/enterprises/1/status",
      payload: { status: "disabled" },
    });
    const credentials = await app.inject({ method: "GET", url: "/api/admin/credentials" });
    const quota = await app.inject({ method: "GET", url: "/api/admin/quota-policy" });
    const unscopedUsers = await app.inject({
      method: "GET",
      url: "/api/admin/users?enterpriseId=99",
    });

    assert.equal(listEnterprises.statusCode, 403);
    assert.equal(createEnterprise.statusCode, 403);
    assert.equal(disableEnterprise.statusCode, 403);
    assert.equal(credentials.statusCode, 403);
    assert.equal(quota.statusCode, 404);
    assert.equal(unscopedUsers.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("org_admin user-list SQL constrains to that enterprise and does not scan unscoped", () => {
  const scope = resolveUserListScope({ role: "org_admin", enterpriseId: 7 });
  assert.equal("forbidden" in scope, false);
  if ("forbidden" in scope) return;

  const compiled = buildAdminUserListQuery({
    limit: 50,
    offset: 0,
    enterpriseId: scope.enterpriseId,
    excludeRoles: scope.excludeRoles,
  }).toSQL();
  const compiledSql = compiled.sql.replace(/\s+/g, " ");

  assert.match(compiledSql, /from "employees"/);
  assert.match(compiledSql, /"employees"\."enterprise_id" = \$/);
  assert.equal(compiled.params.includes(7), true);
  assert.doesNotMatch(compiledSql, /employee_api_keys/);
  assert.doesNotMatch(compiledSql, /\bjoin\b/);
  assert.match(compiledSql, /not in/i);

  const unscoped = buildAdminUserListQuery({ limit: 50, offset: 0 }).toSQL().sql.replace(/\s+/g, " ");
  assert.doesNotMatch(unscoped, /"employees"\."enterprise_id" =/);
});

test("super-admin enterprise list builder selects name and status", () => {
  const compiledSql = buildEnterpriseListQuery().toSQL().sql.replace(/\s+/g, " ");
  assert.match(compiledSql, /from "enterprises"/);
  assert.match(compiledSql, /"name"/);
  assert.match(compiledSql, /"code"/);
  assert.match(compiledSql, /"status"/);
});

test("admin shell source includes 企业管理 and org_admin lands on admin users", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const layout = readFileSync(resolve(root, "web/src/layouts/AdminLayout.vue"), "utf8");
  const home = readFileSync(resolve(root, "web/src/lib/home.ts"), "utf8");
  const router = readFileSync(resolve(root, "web/src/router/index.ts"), "utf8");

  assert.match(layout, /企业管理/);
  assert.match(layout, /isSuperAdmin/);
  assert.match(layout, /\/admin\/enterprises/);
  assert.match(layout, /员工管理/);
  assert.match(layout, /上游渠道/);
  assert.match(home, /org_admin/);
  assert.match(home, /\/admin\/users/);
  assert.doesNotMatch(home, /org_admin.*\/me/);
  assert.match(router, /admin-enterprises/);
  assert.match(router, /org_admin/);
  const login = readFileSync(resolve(root, "web/src/views/LoginView.vue"), "utf8");
  assert.match(login, /个人注册/);
  assert.match(login, /企业注册/);
  const meHome = readFileSync(resolve(root, "web/src/views/me/HomeView.vue"), "utf8");
  assert.match(meHome, /企业编号/);
  assert.match(meHome, /没有 Token 额度/);
});
