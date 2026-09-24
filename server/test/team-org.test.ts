import assert from "node:assert/strict";
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
  employeeDepartmentConflictMessage,
  resolveEmployeeApiKeyTeam,
  resolveTeamListScope,
} = await import("../src/lib/org.js");

const teamAdminSession = {
  sub: "11",
  role: "team_admin" as never,
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
    const members = await app.inject({ method: "GET", url: "/api/admin/teams/1/members" });
    const added = await app.inject({
      method: "POST",
      url: "/api/admin/teams/1/members",
      payload: { phone: "13800138000" },
    });
    const removed = await app.inject({
      method: "DELETE",
      url: "/api/admin/teams/1/members/9",
    });
    assert.equal(list.statusCode, 401);
    assert.equal(members.statusCode, 401);
    assert.equal(added.statusCode, 401);
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

test("team_admin role is rejected by console routes entirely", async () => {
  const { adminDepartmentRoutes } = await import("../src/routes/admin/departments.js");
  const app = Fastify();
  app.addHook("onRequest", attachSession(teamAdminSession));
  await app.register(adminTeamRoutes);
  await app.register(adminEnterpriseRoutes);
  await app.register(adminDepartmentRoutes);
  await app.ready();
  try {
    const createDepartment = await app.inject({
      method: "POST",
      url: "/api/admin/departments",
      payload: { name: "禁用部门" },
    });
    const enterprises = await app.inject({ method: "GET", url: "/api/admin/enterprises" });
    assert.equal(createDepartment.statusCode, 403);
    assert.equal(enterprises.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("team_admin role is no longer a console role and gets no team scope", () => {
  const scope = resolveTeamListScope(
    { role: "team_admin" as never, enterpriseId: 3, employeeId: 11 },
    undefined,
    [8, 9],
  );
  assert.equal("forbidden" in scope, true);
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
    canAdminTeam(actor, { teamId: 9, enterpriseId: 3, departmentId: 6, memberRole: null }),
    false,
  );
});

test("joining a second department is allowed; the same department is a 409", () => {
  const existing = [
    {
      teamId: 2,
      departmentId: 8,
      departmentName: "产品组",
      isDefault: true,
      status: "active",
    },
  ];
  assert.equal(
    employeeDepartmentConflictMessage(existing, { teamId: 9, departmentId: 10 }),
    null,
  );
  assert.equal(
    employeeDepartmentConflictMessage(existing, { teamId: 2, departmentId: 8 }),
    "该员工已在该部门中",
  );
});

test("re-adding a member to the same department keeps the 409 copy", () => {
  assert.equal(
    employeeDepartmentConflictMessage(
      [{ teamId: 8, departmentId: 3, departmentName: "产品组", isDefault: true, status: "active" }],
      { teamId: 8, departmentId: 3 },
    ),
    "该员工已在该部门中",
  );
  assert.equal(employeeDepartmentConflictMessage([], { teamId: 8, departmentId: 3 }), null);
});

test("API Key department binding uses the only membership or the chosen department", () => {
  const memberships = [
    { teamId: 11, departmentId: 8, departmentName: "产品组", isDefault: true, status: "active" },
    { teamId: 12, departmentId: 9, departmentName: "售前咨询部", isDefault: true, status: "active" },
  ];
  assert.equal(resolveEmployeeApiKeyTeam({ memberships, departmentId: 9 })?.teamId, 12);
  assert.equal(resolveEmployeeApiKeyTeam({ memberships }) , null);
  assert.equal(
    resolveEmployeeApiKeyTeam({ memberships: memberships.slice(0, 1) })?.teamId,
    11,
  );
});
