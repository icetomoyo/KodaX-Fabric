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

const { adminTeamRoutes, buildTeamListQuery } = await import("../src/routes/admin/teams.js");
const { adminEnterpriseRoutes } = await import("../src/routes/admin/enterprises.js");
const { meRoutes } = await import("../src/routes/me.js");
const {
  canAdminTeam,
  canCreateTeam,
  canReadTeam,
  employeeSingleTeamConflictMessage,
  resolveTeamListScope,
} = await import("../src/lib/org.js");

const teamAdminSession = {
  sub: "11",
  role: "team_admin" as const,
  phone: "13800000011",
  name: "TeamAdmin",
  mustChangePassword: false,
  enterpriseId: 3,
};

function attachSession(session: typeof teamAdminSession) {
  return async (req: { session?: typeof teamAdminSession; employeeId?: number }) => {
    req.session = session;
    req.employeeId = Number(session.sub);
  };
}

test("unauthenticated department calls return 401", async () => {
  const { adminDepartmentRoutes } = await import("../src/routes/admin/departments.js");
  const app = Fastify();
  await app.register(adminDepartmentRoutes);
  await app.ready();
  try {
    const list = await app.inject({ method: "GET", url: "/api/admin/departments" });
    const create = await app.inject({
      method: "POST",
      url: "/api/admin/departments",
      payload: { name: "研发中心" },
    });
    const removed = await app.inject({ method: "DELETE", url: "/api/admin/departments/1" });
    assert.equal(list.statusCode, 401);
    assert.equal(create.statusCode, 401);
    assert.equal(removed.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("unauthenticated team calls return 401", async () => {
  const app = Fastify();
  await app.register(adminTeamRoutes);
  await app.ready();
  try {
    const list = await app.inject({ method: "GET", url: "/api/admin/teams" });
    const create = await app.inject({
      method: "POST",
      url: "/api/admin/teams",
      payload: { name: "研发" },
    });
    const members = await app.inject({ method: "GET", url: "/api/admin/teams/1/members" });
    const removed = await app.inject({ method: "DELETE", url: "/api/admin/teams/1" });
    assert.equal(list.statusCode, 401);
    assert.equal(create.statusCode, 401);
    assert.equal(members.statusCode, 401);
    assert.equal(removed.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("creating an API key without a team is rejected", async () => {
  const app = Fastify();
  app.addHook("onRequest", attachSession({
    ...teamAdminSession,
    role: "employee",
    sub: "12",
  }));
  await app.register(meRoutes);
  await app.ready();
  try {
    const created = await app.inject({
      method: "POST",
      url: "/api/me/api-keys",
      payload: { name: "cursor", productLineId: 1, protocol: "openai_chat" },
    });
    assert.equal(created.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("team_admin cannot create teams or call super-admin enterprise APIs", async () => {
  const app = Fastify();
  app.addHook("onRequest", attachSession(teamAdminSession));
  await app.register(adminTeamRoutes);
  await app.register(adminEnterpriseRoutes);
  await app.ready();
  try {
    const create = await app.inject({
      method: "POST",
      url: "/api/admin/teams",
      payload: { name: "Forbidden Team", enterpriseId: 3, departmentId: 1 },
    });
    const enterprises = await app.inject({ method: "GET", url: "/api/admin/enterprises" });
    assert.equal(create.statusCode, 403);
    assert.equal(enterprises.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("team_admin list SQL is constrained to administered teams", () => {
  const scope = resolveTeamListScope(
    { role: "team_admin", enterpriseId: 3, employeeId: 11 },
    undefined,
    [8, 9],
  );
  assert.equal("forbidden" in scope, false);
  if ("forbidden" in scope) return;
  const compiled = buildTeamListQuery(scope).toSQL();
  const compiledSql = compiled.sql.replace(/\s+/g, " ");
  assert.match(compiledSql, /from "teams"/);
  assert.doesNotMatch(compiledSql, /monthly_yuan_quota/);
  assert.match(compiledSql, /usage_counters_team_daily/);
  assert.match(compiledSql, /"teams"\."id" in/i);
  assert.equal(compiled.params.includes(8), true);
  assert.equal(compiled.params.includes(9), true);
});

test("org_admin list SQL constrains teams to one enterprise", () => {
  const scope = resolveTeamListScope(
    { role: "org_admin", enterpriseId: 4, employeeId: 2 },
    undefined,
    [],
  );
  assert.equal("forbidden" in scope, false);
  if ("forbidden" in scope) return;
  const compiled = buildTeamListQuery(scope).toSQL();
  const compiledSql = compiled.sql.replace(/\s+/g, " ");
  assert.match(compiledSql, /"teams"\."enterprise_id" =/);
  assert.equal(compiled.params.includes(4), true);
  assert.doesNotMatch(compiled.sql.replace(/\s+/g, " "), /"teams"\."id" in/i);
});

test("super-admin can list and create teams in any enterprise", () => {
  const actor = { role: "admin" as const, enterpriseId: 1, employeeId: 1 };
  const scoped = resolveTeamListScope(actor, 4, []);
  assert.equal("forbidden" in scoped, false);
  if ("forbidden" in scoped) return;
  assert.equal(scoped.enterpriseId, 4);

  const all = resolveTeamListScope(actor, undefined, []);
  assert.equal("forbidden" in all, false);
  if ("forbidden" in all) return;
  assert.equal(all.enterpriseId, undefined);
  assert.equal(all.teamIds, undefined);

  assert.equal(canCreateTeam(actor, 9), true);
  assert.equal(
    canAdminTeam(actor, { teamId: 2, enterpriseId: 9, departmentId: 1, memberRole: null }),
    true,
  );
  assert.equal(
    canReadTeam(actor, { teamId: 2, enterpriseId: 9, departmentId: 1, memberRole: null }),
    true,
  );
});

test("dept_admin list SQL is constrained to administered departments", () => {
  const scope = resolveTeamListScope(
    { role: "dept_admin", enterpriseId: 3, employeeId: 11, departmentIds: [5] },
    undefined,
    [],
  );
  assert.equal("forbidden" in scope, false);
  if ("forbidden" in scope) return;
  const compiled = buildTeamListQuery(scope).toSQL();
  const compiledSql = compiled.sql.replace(/\s+/g, " ");
  assert.match(compiledSql, /"teams"\."department_id" in/i);
  assert.equal(compiled.params.includes(5), true);
  assert.doesNotMatch(compiledSql, /"teams"\."id" in/i);
});

test("dept_admin can create teams only in their department", () => {
  const actor = {
    role: "dept_admin" as const,
    enterpriseId: 3,
    employeeId: 11,
    departmentIds: [5],
  };
  assert.equal(canCreateTeam(actor, 3, 5), true);
  assert.equal(canCreateTeam(actor, 3, 6), false);
  assert.equal(canCreateTeam(actor, 4, 5), false);
  assert.equal(
    canAdminTeam(actor, { teamId: 2, enterpriseId: 3, departmentId: 5, memberRole: null }),
    true,
  );
  assert.equal(
    canAdminTeam(actor, { teamId: 9, enterpriseId: 3, departmentId: 6, memberRole: null }),
    false,
  );
});

test("editing a named team can reassign it to another department in the same enterprise", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const teamsRoute = readFileSync(resolve(root, "server/src/routes/admin/teams.ts"), "utf8");
  const patchStart = teamsRoute.indexOf('app.patch("/api/admin/teams/:id"');
  const patch = teamsRoute.slice(
    patchStart,
    teamsRoute.indexOf('app.delete("/api/admin/teams/:id"', patchStart),
  );
  assert.match(patch, /departmentId: z.number\(\)\.int\(\)\.positive\(\)\.optional\(\)/);
  assert.match(patch, /不能把团队调到其他企业的部门/);
  assert.match(patch, /默认团队不能改名、停用或更换部门/);
  const teamsView = readFileSync(resolve(root, "web/src/views/admin/TeamsView.vue"), "utf8");
  const teamsEdit = teamsView.slice(teamsView.indexOf('v-model="showEdit"'));
  assert.match(teamsEdit, /所属部门/);
  assert.match(teamsEdit, /editDepartmentId/);
  assert.match(teamsView, /departmentId: editDepartmentId.value/);
  const enterprisesView = readFileSync(resolve(root, "web/src/views/admin/EnterprisesView.vue"), "utf8");
  const enterpriseEdit = enterprisesView.slice(enterprisesView.indexOf('v-model="showEditTeam"'));
  assert.match(enterpriseEdit, /所属部门/);
  assert.match(enterprisesView, /departmentId: editTeamDepartmentId.value/);
});

test("editing an employee team only lists teams in the same department", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const usersView = readFileSync(resolve(root, "web/src/views/admin/UsersView.vue"), "utf8");
  assert.match(usersView, /editTeamOptions/);
  assert.match(usersView, /departmentId === current.departmentId/);
  const enterprisesView = readFileSync(resolve(root, "web/src/views/admin/EnterprisesView.vue"), "utf8");
  assert.match(enterprisesView, /editUserTeamOptions/);
  assert.match(enterprisesView, /departmentId === current.departmentId/);
});


test("key binding page is a full canvas with a filter drawer and unbound-key entry", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const view = readFileSync(resolve(root, "web/src/views/admin/KeyBindingsView.vue"), "utf8");
  assert.doesNotMatch(view, /page-title">调度画布/);
  assert.match(view, /el-drawer/);
  assert.match(view, /当前企业/);
  assert.doesNotMatch(view, /展示程度/);
  assert.doesNotMatch(view, /部门级/);
  assert.doesNotMatch(view, /团队级/);
  assert.match(view, /资源/);
  assert.doesNotMatch(view, /未绑定 Key/);
  assert.match(view, /resourceKeys/);
  assert.match(view, /hydrateOrgChain/);
  assert.match(view, /\/api\/admin\/departments/);
  assert.match(view, /isScheduledUseKind/);
  assert.match(view, /kind === "dedicated" \|\| kind === "department_shared" \|\| kind === "open_shared"/);
  assert.match(view, /fab-stack/);
});

test("admin shell uses org board for all console roles", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const layout = readFileSync(resolve(root, "web/src/layouts/AdminLayout.vue"), "utf8");
  const home = readFileSync(resolve(root, "web/src/lib/home.ts"), "utf8");
  const router = readFileSync(resolve(root, "web/src/router/index.ts"), "utf8");
  assert.match(layout, /企业管理/);
  assert.match(layout, /本企业编制/);
  assert.match(layout, /本部门编制/);
  assert.match(layout, /v-if="auth.isTeamAdmin" index="\/admin\/enterprises">员工/);
  assert.doesNotMatch(layout, /index="\/admin\/departments"/);
  assert.doesNotMatch(layout, /index="\/admin\/teams"/);
  assert.doesNotMatch(layout, /index="\/admin\/members"/);
  assert.doesNotMatch(layout, /index="\/admin\/keys"/);
  assert.match(home, /dept_admin/);
  assert.match(router, /dept_admin/);
  assert.doesNotMatch(layout, /项目管理/);
  assert.doesNotMatch(layout, /\/admin\/projects/);
  assert.match(home, /team_admin/);
  assert.match(home, /return \"\/admin\"/);
  assert.doesNotMatch(router, /admin-projects/);
  assert.match(router, /admin-keys/);
  assert.match(router, /team_admin/);
  const orgView = readFileSync(resolve(root, "web/src/views/admin/EnterprisesView.vue"), "utf8");
  assert.match(orgView, /showEnterprisePane/);
  assert.match(orgView, /showDepartmentPane/);
  assert.match(orgView, /showTeamPane/);
  assert.match(orgView, /邀请已注册员工/);
});

test("joining a second team is rejected with a named 409 message", () => {
  assert.equal(
    employeeSingleTeamConflictMessage({ teamId: 2, teamName: "研发一组" }, 8),
    "该员工已加入团队 研发一组，一名员工只能属于一个团队",
  );
  const teamsRoute = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../src/routes/admin/teams.ts"),
    "utf8",
  );
  assert.match(teamsRoute, /employeeSingleTeamConflictMessage/);
  assert.match(teamsRoute, /code\(409\)/);
});

test("re-adding a member to the same team keeps the existing 409 copy", () => {
  assert.equal(
    employeeSingleTeamConflictMessage({ teamId: 8, teamName: "研发一组" }, 8),
    "该员工已在团队中",
  );
  assert.equal(employeeSingleTeamConflictMessage(null, 8), null);
});

test("team member add dialog surfaces backend 409 messages", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const membersView = readFileSync(resolve(root, "web/src/views/admin/MembersView.vue"), "utf8");
  assert.match(membersView, /response\?\.data\?\.message/);
  assert.match(membersView, /已注册用户的手机号/);
});

test("employee unique membership migration cleans duplicates before the unique index", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const journal = JSON.parse(
    readFileSync(resolve(root, "drizzle/meta/_journal.json"), "utf8"),
  ) as { entries: Array<{ tag: string }> };
  const migration = journal.entries
    .map((entry) => readFileSync(resolve(root, `drizzle/${entry.tag}.sql`), "utf8"))
    .find((sql) => sql.includes('CREATE UNIQUE INDEX "team_members_employee_uidx"'));
  assert.ok(migration, "expected a migration that creates team_members_employee_uidx");
  const deleteAt = migration.indexOf('DELETE FROM "team_members"');
  const indexAt = migration.indexOf('CREATE UNIQUE INDEX "team_members_employee_uidx"');
  assert.ok(deleteAt >= 0, "expected a cleanup DELETE before the unique index");
  assert.ok(indexAt > deleteAt);
  assert.match(migration, /team_admin/);
  assert.match(migration, /created_at/);
});
