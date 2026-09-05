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
const { canAccessEmployee, resolveUpdatedUserFields, resolveUserListScope } = await import(
  "../src/lib/enterprise.js"
);
const { authRoutes } = await import("../src/routes/auth.js");

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
    const applyEnterprise = await app.inject({
      method: "POST",
      url: "/api/me/enterprise-applications",
      payload: { name: "申请企业" },
    });
    assert.equal(joinEnterprise.statusCode, 401);
    assert.equal(applyEnterprise.statusCode, 401);
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
    const approveEnterprise = await app.inject({
      method: "POST",
      url: "/api/admin/enterprises/1/approve",
    });
    const createUser = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      payload: { name: "A", phone: "13800001111", password: "ChangeMe@123" },
    });
    const importUsers = await app.inject({
      method: "POST",
      url: "/api/admin/users/import",
      payload: { users: [{ name: "A", phone: "13800001111", password: "ChangeMe@123" }] },
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
    assert.equal(approveEnterprise.statusCode, 403);
    assert.equal(createUser.statusCode, 403);
    assert.equal(importUsers.statusCode, 403);
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
  assert.deepEqual(scope.excludeRoles, ["admin", "org_admin"]);

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
  assert.equal(compiled.params.includes("admin"), true);
  assert.equal(compiled.params.includes("org_admin"), true);
  assert.doesNotMatch(compiledSql, /employee_api_keys/);
  assert.match(compiledSql, /left join "team_members"/);
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
  assert.doesNotMatch(compiledSql, /package_plan/);
});

test("self-register rejects missing or weak passwords without writing an account", async () => {
  const app = Fastify();
  await app.register(authRoutes);
  await app.ready();
  try {
    const missing = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { name: "测试", phone: "13900001111" },
    });
    const weak = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { name: "测试", phone: "13900001111", password: "123" },
    });
    assert.equal(missing.statusCode, 400);
    assert.equal(weak.statusCode, 400);
    assert.match(String(weak.json().message), /密码/);
  } finally {
    await app.close();
  }
});

test("super-admin approves cooperation applications instead of assigning admins", async () => {
  const app = Fastify();
  await app.register(adminEnterpriseRoutes);
  await app.register(meRoutes);
  await app.ready();
  try {
    assert.equal(app.hasRoute({ method: "POST", url: "/api/admin/enterprises/:id/approve" }), true);
    assert.equal(app.hasRoute({ method: "POST", url: "/api/admin/enterprises/:id/admins" }), false);
    assert.equal(app.hasRoute({ method: "POST", url: "/api/me/enterprise-applications" }), true);
    const meRoute = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../src/routes/me.ts"),
      "utf8",
    );
    assert.match(meRoute, /已关闭合作企业申请/);
  } finally {
    await app.close();
  }
});

test("super-admin still cannot create employees", async () => {
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
    assert.equal(app.hasRoute({ method: "GET", url: "/api/admin/users" }), true);
  } finally {
    await app.close();
  }
});

test("org_admin can assign employee, dept_admin and team_admin but not org_admin or super-admin", () => {
  const actor = { role: "org_admin" as const, enterpriseId: 3 };
  const target = { role: "employee" as const, enterpriseId: 3 };
  const keep = resolveUpdatedUserFields(actor, target, {});
  assert.equal("error" in keep, false);
  if ("error" in keep) return;
  assert.equal(keep.role, "employee");

  const toTeamAdmin = resolveUpdatedUserFields(actor, target, { role: "team_admin" });
  assert.equal("error" in toTeamAdmin, false);
  if ("error" in toTeamAdmin) return;
  assert.equal(toTeamAdmin.role, "team_admin");

  const toDeptAdmin = resolveUpdatedUserFields(actor, target, { role: "dept_admin" });
  assert.equal("error" in toDeptAdmin, false);
  if ("error" in toDeptAdmin) return;
  assert.equal(toDeptAdmin.role, "dept_admin");

  const deptActor = { role: "dept_admin" as const, enterpriseId: 3 };
  const deptToPeer = resolveUpdatedUserFields(deptActor, target, { role: "dept_admin" });
  assert.equal("error" in deptToPeer, true);

  const toOrgAdmin = resolveUpdatedUserFields(actor, target, { role: "org_admin" });
  assert.equal("error" in toOrgAdmin, true);

  const toSuper = resolveUpdatedUserFields(actor, target, { role: "admin" });
  assert.equal("error" in toSuper, true);
});

test("super-admin can assign org_admin but not another super-admin", () => {
  const actor = { role: "admin" as const, enterpriseId: 1 };
  const target = { role: "employee" as const, enterpriseId: 3 };
  const toOrgAdmin = resolveUpdatedUserFields(actor, target, { role: "org_admin" });
  assert.equal("error" in toOrgAdmin, false);
  if ("error" in toOrgAdmin) return;
  assert.equal(toOrgAdmin.role, "org_admin");
  assert.equal(toOrgAdmin.enterpriseId, 3);

  const toSuper = resolveUpdatedUserFields(actor, target, { role: "admin" });
  assert.equal("error" in toSuper, true);
});

test("super-admin can list and access employees in any enterprise", () => {
  const scoped = resolveUserListScope({ role: "admin", enterpriseId: 1 }, 3);
  assert.equal("forbidden" in scoped, false);
  if ("forbidden" in scoped) return;
  assert.equal(scoped.enterpriseId, 3);
  assert.deepEqual(scoped.excludeRoles, ["admin"]);
  assert.equal(
    canAccessEmployee(
      { role: "admin", enterpriseId: 1 },
      { role: "employee", enterpriseId: 3 },
    ),
    true,
  );
  assert.equal(
    canAccessEmployee(
      { role: "admin", enterpriseId: 1 },
      { role: "org_admin", enterpriseId: 3 },
    ),
    true,
  );
  assert.equal(
    canAccessEmployee(
      { role: "admin", enterpriseId: 1 },
      { role: "admin", enterpriseId: null },
    ),
    false,
  );
});

test("admin shell source includes 企业管理 and org_admin lands on workbench", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const layout = readFileSync(resolve(root, "web/src/layouts/AdminLayout.vue"), "utf8");
  const home = readFileSync(resolve(root, "web/src/lib/home.ts"), "utf8");
  const router = readFileSync(resolve(root, "web/src/router/index.ts"), "utf8");

  assert.match(layout, /企业管理/);
  assert.match(layout, /isSuperAdmin/);
  assert.match(layout, /\/admin\/enterprises/);
  assert.match(layout, /本企业编制/);
  assert.match(layout, /isOrgAdmin/);
  assert.match(layout, /上游渠道/);
  assert.doesNotMatch(layout, /员工管理/);
  assert.doesNotMatch(layout, /index="\/admin\/teams"/);
  assert.match(home, /org_admin/);
  assert.match(home, /return \"\/admin\"/);
  assert.doesNotMatch(home, /org_admin.*\/me/);
  assert.match(router, /admin-enterprises/);
  assert.match(router, /org_admin/);
  const login = readFileSync(resolve(root, "web/src/views/LoginView.vue"), "utf8");
  const register = readFileSync(resolve(root, "web/src/views/RegisterView.vue"), "utf8");
  assert.match(login, /申请注册/);
  assert.doesNotMatch(login, /企业注册/);
  assert.doesNotMatch(login, /Hz@123456/);
  assert.match(register, /提交注册/);
  assert.match(register, /registerForm.password/);
  assert.doesNotMatch(register, /企业注册/);
  assert.doesNotMatch(register, /Hz@123456/);
  const meHome = readFileSync(resolve(root, "web/src/views/me/HomeView.vue"), "utf8");
  assert.doesNotMatch(meHome, /申请合作企业/);
  assert.match(meHome, /普通注册用户/);
  assert.match(meHome, /邀请进团队/);
  const enterprisesView = readFileSync(
    resolve(root, "web/src/views/admin/EnterprisesView.vue"),
    "utf8",
  );
  assert.doesNotMatch(enterprisesView, /\/enterprises\/\$\{.*\}\/approve/);
  assert.doesNotMatch(enterprisesView, /合作申请/);
  assert.doesNotMatch(enterprisesView, /分配套餐/);
  assert.doesNotMatch(enterprisesView, /ENTERPRISE_PACKAGES/);
  assert.doesNotMatch(enterprisesView, /指定企业管理员/);
  const usersView = readFileSync(resolve(root, "web/src/views/admin/UsersView.vue"), "utf8");
  assert.match(usersView, /邀请已注册员工/);
  assert.doesNotMatch(usersView, /新建员工/);
  assert.doesNotMatch(usersView, /批量导入/);
});
