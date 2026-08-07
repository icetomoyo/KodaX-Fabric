import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const { createTicketNumber } = await import("../src/lib/tickets.js");
const { meTicketRoutes, buildEmployeeTicketListQuery } = await import(
  "../src/routes/me-tickets.js"
);
const { adminTicketRoutes, buildAdminTicketListQuery } = await import(
  "../src/routes/admin/tickets.js"
);

test("ticket numbers contain the UTC date and an uppercase random suffix", () => {
  const number = createTicketNumber(
    new Date("2026-08-07T23:59:59.000Z"),
    "a1b2c3d4e5f6",
  );
  assert.equal(number, "TK-20260807-A1B2C3D4E5F6");
  assert.match(
    createTicketNumber(new Date("2026-08-07T00:00:00.000Z")),
    /^TK-20260807-[0-9A-F]{16}$/,
  );
});

test("employee ticket list is scoped to the current employee and omits content", () => {
  const query = buildEmployeeTicketListQuery({
    employeeId: 42,
    limit: 10,
    offset: 0,
  }).toSQL();
  const compiledSql = query.sql.replace(/\s+/g, " ");

  assert.match(compiledSql, /from "tickets"/);
  assert.match(compiledSql, /where "tickets"\."employee_id" = \$1/);
  assert.equal(query.params[0], 42);
  assert.doesNotMatch(compiledSql, /"content"/);
  assert.doesNotMatch(compiledSql, /join "employees"/);
});

test("admin ticket list joins employee data and searches all documented fields", () => {
  const query = buildAdminTicketListQuery({
    limit: 10,
    offset: 0,
    q: "张三",
  }).toSQL();
  const compiledSql = query.sql.replace(/\s+/g, " ");

  assert.match(compiledSql, /inner join "employees"/);
  assert.match(compiledSql, /"tickets"\."ticket_no" ilike/);
  assert.match(compiledSql, /"tickets"\."subject" ilike/);
  assert.match(compiledSql, /"employees"\."name" ilike/);
  assert.doesNotMatch(compiledSql, /"content"/);
});

test("employee and admin ticket endpoints are registered separately", async () => {
  const app = Fastify();
  await app.register(meTicketRoutes);
  await app.register(adminTicketRoutes);
  await app.ready();

  try {
    assert.equal(app.hasRoute({ method: "POST", url: "/api/me/tickets" }), true);
    assert.equal(app.hasRoute({ method: "GET", url: "/api/me/tickets" }), true);
    assert.equal(app.hasRoute({ method: "GET", url: "/api/me/tickets/:id" }), true);
    assert.equal(app.hasRoute({ method: "GET", url: "/api/admin/tickets" }), true);
    assert.equal(app.hasRoute({ method: "GET", url: "/api/admin/tickets/:id" }), true);
    assert.equal(app.hasRoute({ method: "POST", url: "/api/admin/tickets" }), false);
  } finally {
    await app.close();
  }
});
