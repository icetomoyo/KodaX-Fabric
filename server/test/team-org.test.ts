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
const { resolveTeamListScope } = await import("../src/lib/org.js");

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
    assert.equal(list.statusCode, 401);
    assert.equal(create.statusCode, 401);
    assert.equal(members.statusCode, 401);
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
      payload: { name: "Forbidden Team", enterpriseId: 3 },
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
  assert.match(compiledSql, /daily_token_quota/);
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

test("admin shell source includes 团队管理 for org and team admins", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const layout = readFileSync(resolve(root, "web/src/layouts/AdminLayout.vue"), "utf8");
  const home = readFileSync(resolve(root, "web/src/lib/home.ts"), "utf8");
  const router = readFileSync(resolve(root, "web/src/router/index.ts"), "utf8");
  assert.match(layout, /团队管理/);
  assert.match(home, /team_admin/);
  assert.match(home, /\/admin\/teams/);
  assert.match(router, /admin-teams/);
  assert.match(router, /team_admin/);
});
