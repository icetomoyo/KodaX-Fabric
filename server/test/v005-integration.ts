/**
 * Explicit v0.0.5 ticket database/API integration test.
 *
 * Run only against a migrated development/test database. Every fixture is
 * uniquely tagged and cleanup deletes only rows created by this run.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import Fastify, { type LightMyRequestResponse } from "fastify";

const [
  { db, sql },
  { employees, tickets },
  { signSession },
  { meTicketRoutes },
  { adminTicketRoutes },
] = await Promise.all([
  import("../src/db/client.js"),
  import("../src/db/schema/index.js"),
  import("../src/lib/jwt.js"),
  import("../src/routes/me-tickets.js"),
  import("../src/routes/admin/tickets.js"),
]);

type FixtureKey = "employeeA" | "employeeB" | "admin";
type FixtureUser = {
  id: number;
  name: string;
  phone: string;
  role: "employee" | "admin";
  token: string;
};

const marker = randomUUID().replaceAll("-", "").slice(0, 8);
const employeeIds: number[] = [];
const users = new Map<FixtureKey, FixtureUser>();
const app = Fastify({ logger: false });

function json<T>(response: LightMyRequestResponse): T {
  assert.match(String(response.headers["content-type"] ?? ""), /application\/json/i);
  return response.json<T>();
}

function auth(key: FixtureKey) {
  const user = users.get(key);
  assert(user);
  return { authorization: `Bearer ${user.token}` };
}

async function createUser(key: FixtureKey, role: "employee" | "admin") {
  const name = `${key}-${marker}`;
  const phonePrefix: Record<FixtureKey, string> = {
    employeeA: "ea",
    employeeB: "eb",
    admin: "ad",
  };
  const phone = `${phonePrefix[key]}${marker}`;
  const [row] = await db
    .insert(employees)
    .values({
      name,
      phone,
      passwordHash: "v005-integration-only",
      dept: `dept-${marker}`,
      role,
      status: "active",
      mustChangePassword: false,
    })
    .returning({ id: employees.id });
  employeeIds.push(row.id);
  users.set(key, {
    id: row.id,
    name,
    phone,
    role,
    token: await signSession({
      sub: String(row.id),
      role,
      phone,
      name,
      mustChangePassword: false,
    }),
  });
}

async function cleanup() {
  if (!employeeIds.length) return;
  await db.delete(tickets).where(inArray(tickets.employeeId, employeeIds));
  await db.delete(employees).where(inArray(employees.id, employeeIds));
}

async function main() {
  try {
    await cleanup();
    await createUser("employeeA", "employee");
    await createUser("employeeB", "employee");
    await createUser("admin", "admin");

    await app.register(meTicketRoutes);
    await app.register(adminTicketRoutes);
    await app.ready();

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/me/tickets",
      headers: auth("employeeA"),
      payload: {
        subject: "无法调用模型",
        content: "请求返回错误，请协助排查。<script>alert('x')</script>",
      },
    });
    assert.equal(createResponse.statusCode, 201);
    const created = json<{
      success: true;
      data: { id: number; ticketNo: string; subject: string; content: string };
    }>(createResponse).data;
    assert.match(created.ticketNo, /^TK-\d{8}-[0-9A-F]{16}$/);
    assert.equal(created.subject, "无法调用模型");

    const ownListResponse = await app.inject({
      method: "GET",
      url: "/api/me/tickets?limit=10&offset=0",
      headers: auth("employeeA"),
    });
    assert.equal(ownListResponse.statusCode, 200);
    const ownList = json<{
      success: true;
      data: { total: number; items: Array<Record<string, unknown>> };
    }>(ownListResponse).data;
    assert.equal(ownList.total, 1);
    assert.equal(ownList.items[0]?.ticketNo, created.ticketNo);
    assert.equal(Object.hasOwn(ownList.items[0]!, "content"), false);

    const ownDetailResponse = await app.inject({
      method: "GET",
      url: `/api/me/tickets/${created.id}`,
      headers: auth("employeeA"),
    });
    assert.equal(ownDetailResponse.statusCode, 200);
    assert.equal(
      json<{ data: { content: string } }>(ownDetailResponse).data.content,
      created.content,
    );

    const otherDetailResponse = await app.inject({
      method: "GET",
      url: `/api/me/tickets/${created.id}`,
      headers: auth("employeeB"),
    });
    assert.equal(otherDetailResponse.statusCode, 404);

    const employeeA = users.get("employeeA")!;
    const adminListResponse = await app.inject({
      method: "GET",
      url: "/api/admin/tickets",
      query: { q: employeeA.name, limit: "10", offset: "0" },
      headers: auth("admin"),
    });
    assert.equal(adminListResponse.statusCode, 200);
    const adminList = json<{
      data: { total: number; items: Array<Record<string, unknown>> };
    }>(adminListResponse).data;
    assert.equal(adminList.total, 1);
    assert.equal(adminList.items[0]?.employeeName, employeeA.name);
    assert.equal(Object.hasOwn(adminList.items[0]!, "content"), false);

    const adminDetailResponse = await app.inject({
      method: "GET",
      url: `/api/admin/tickets/${created.id}`,
      headers: auth("admin"),
    });
    assert.equal(adminDetailResponse.statusCode, 200);
    const adminDetail = json<{
      data: { employeePhone: string; content: string };
    }>(adminDetailResponse).data;
    assert.equal(adminDetail.employeePhone, employeeA.phone);
    assert.equal(adminDetail.content, created.content);

    const employeeAdminAccess = await app.inject({
      method: "GET",
      url: "/api/admin/tickets",
      headers: auth("employeeA"),
    });
    assert.equal(employeeAdminAccess.statusCode, 403);

    const adminEmployeeAccess = await app.inject({
      method: "GET",
      url: "/api/me/tickets",
      headers: auth("admin"),
    });
    assert.equal(adminEmployeeAccess.statusCode, 403);

    const invalidCreate = await app.inject({
      method: "POST",
      url: "/api/me/tickets",
      headers: auth("employeeA"),
      payload: { subject: " ", content: " " },
    });
    assert.equal(invalidCreate.statusCode, 400);

    console.log("v0.0.5 ticket integration passed", {
      ticketNo: created.ticketNo,
      employeeIsolation: true,
      roleIsolation: true,
    });
  } finally {
    await app.close();
    await cleanup();
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
