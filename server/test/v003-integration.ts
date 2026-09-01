/**
 * Explicit v0.0.3 database/API integration test.
 *
 * Run only against a migrated development/test database. Every fixture is
 * uniquely tagged and cleanup deletes only IDs created by this run.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import Fastify, { type LightMyRequestResponse } from "fastify";

const [
  { env },
  { db, sql },
  schema,
  { hashPassword },
  { signSession },
  { getDefaultEnterpriseId },
  { quotaDayAt },
  { adminUserRoutes },
  { adminLogRoutes },
] = await Promise.all([
  import("../src/config.js"),
  import("../src/db/client.js"),
  import("../src/db/schema/index.js"),
  import("../src/lib/password.js"),
  import("../src/lib/jwt.js"),
  import("../src/lib/enterprise.js"),
  import("../src/lib/quota-time.js"),
  import("../src/routes/admin/users.js"),
  import("../src/routes/admin/logs.js"),
]);

const {
  employees,
  opsAuditLogs,
  requestAudits,
  usageCountersDaily,
} = schema;

type Role = "employee" | "admin" ;
type User = { id: number; role: Role; token: string };

const marker = `v3_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
const employeeIds: number[] = [];
const requestIds = [`${marker}_known`, `${marker}_unknown`];
const users = new Map<Role, User>();
const app = Fastify({ logger: false });

function json<T>(response: LightMyRequestResponse): T {
  assert.match(String(response.headers["content-type"] ?? ""), /application\/json/i);
  return response.json<T>();
}

function auth(role: Role) {
  const user = users.get(role);
  assert(user);
  return { authorization: `Bearer ${user.token}` };
}

function assertNoSensitiveEmployeeUsage(value: unknown) {
  const forbidden = new Set([
    "apiKey",
    "apiKeys",
    "keyPrefix",
    "keyHash",
    "keyEncrypted",
    "secret",
    "secretSuffix",
  ]);
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) return void candidate.forEach(visit);
    if (!candidate || typeof candidate !== "object") return;
    for (const [key, child] of Object.entries(candidate as Record<string, unknown>)) {
      assert.equal(forbidden.has(key), false, `usage response leaked ${key}`);
      visit(child);
    }
  };
  visit(value);
}

async function createFixtures() {
  const passwordHash = await hashPassword("V003Integration@123");
  const enterpriseId = await getDefaultEnterpriseId();
  for (const role of ["employee", "admin"] as const) {
    const [row] = await db
      .insert(employees)
      .values({
        name: `${role}-${marker}`,
        phone: `${role.slice(0, 3)}_${marker}`,
        passwordHash,
        dept: `dept-${marker}`,
        role,
        status: "active",
        enterpriseId,
        mustChangePassword: false,
      })
      .returning({ id: employees.id });
    employeeIds.push(row.id);
    users.set(role, {
      id: row.id,
      role,
      token: await signSession({
        sub: String(row.id),
        role,
        phone: `${role.slice(0, 3)}_${marker}`,
        name: `${role}-${marker}`,
        mustChangePassword: false,
        enterpriseId,
      }),
    });
  }

  const employee = users.get("employee")!;
  const day = quotaDayAt(new Date(), env.QUOTA_TIMEZONE);
  await db.insert(usageCountersDaily).values({
    day,
    employeeId: employee.id,
    promptTokens: 7,
    completionTokens: 3,
    totalTokens: 10,
    requestCount: 2,
    errorCount: 1,
  });
  await db.insert(requestAudits).values([
    {
      requestId: requestIds[0],
      employeeId: employee.id,
      clientModel: "v003-model-a",
      providerCode: "v003-provider",
      status: "success",
      promptTokens: 7,
      completionTokens: 3,
      totalTokens: 10,
      cacheReadTokens: 2,
    },
    {
      requestId: requestIds[1],
      employeeId: employee.id,
      clientModel: "v003-model-b",
      providerCode: "v003-provider",
      status: "upstream_error",
      totalTokens: null,
    },
  ]);
  return day;
}

async function cleanup() {
  if (employeeIds.length) {
    await db.delete(opsAuditLogs).where(inArray(opsAuditLogs.actorEmployeeId, employeeIds));
  }
  await db.delete(requestAudits).where(inArray(requestAudits.requestId, requestIds));
  if (employeeIds.length) {
    await db.delete(usageCountersDaily).where(inArray(usageCountersDaily.employeeId, employeeIds));
    await db.delete(employees).where(inArray(employees.id, employeeIds));
  }
}

async function main() {
  let day = "";
  try {
    day = await createFixtures();
    await app.register(adminUserRoutes);
    await app.register(adminLogRoutes);
    await app.ready();

    const employee = users.get("employee")!;
    const deniedUsage = await app.inject({
      method: "GET",
      url: `/api/admin/users/${employee.id}/usage?from=${day}&to=${day}`,
      headers: auth("employee"),
    });
    assert.equal(deniedUsage.statusCode, 403);

    const usageResponse = await app.inject({
      method: "GET",
      url: `/api/admin/users/${employee.id}/usage?from=${day}&to=${day}`,
      headers: auth("admin"),
    });
    assert.equal(usageResponse.statusCode, 200);
    const usage = json<{ data: any }>(usageResponse).data;
    assert.equal(usage.summary.totalTokens, 10);
    assert.equal(usage.summary.requestCount, 2);
    assert.equal(usage.summary.errorCount, 1);
    assert.equal(usage.daily.reduce((sum: number, row: any) => sum + row.totalTokens, 0), 10);
    assert.equal(usage.unknownUsageCount, 1);
    assertNoSensitiveEmployeeUsage(usage);

    const logsResponse = await app.inject({
      method: "GET",
      url: `/api/admin/logs?requestId=${requestIds[0]}`,
      headers: auth("admin"),
    });
    assert.equal(logsResponse.statusCode, 200);
    const logs = json<{ data: { items: Array<Record<string, unknown>> } }>(logsResponse).data;
    assert.equal(logs.items.length, 1);
    assert.equal(logs.items[0].totalTokens, 10);
    assert.equal(logs.items[0].cacheReadTokens, 2);
    assert.equal(logs.items[0].employeeName, `employee-${marker}`);
    assert.equal(logs.items[0].credits, 0);
    assert.equal("requestBody" in logs.items[0], false);
    assert.equal("responseBody" in logs.items[0], false);

    const byEmployee = await app.inject({
      method: "GET",
      url: `/api/admin/logs?employeeId=${employee.id}`,
      headers: auth("admin"),
    });
    assert.equal(byEmployee.statusCode, 200);
    assert.equal(json<{ data: { total: number } }>(byEmployee).data.total, 2);

    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/admin/logs/${requestIds[0]}`,
      headers: auth("admin"),
    });
    assert.equal(detailResponse.statusCode, 200);
    const detail = json<{ data: Record<string, unknown> }>(detailResponse).data;
    assert.equal(detail.requestId, requestIds[0]);
    assert.equal(detail.employeeName, `employee-${marker}`);
    assert.equal(detail.credits, 0);
    assert.equal(detail.hasContextFile, false);
    assert.equal(detail.omittedBodies, false);
    assert.equal(detail.context, null);

    const missingContext = await app.inject({
      method: "GET",
      url: `/api/admin/logs/${requestIds[0]}/context`,
      headers: auth("admin"),
    });
    assert.equal(missingContext.statusCode, 404);

    console.log("v0.0.3 integration checks passed");
  } finally {
    await app.close().catch(() => undefined);
    await cleanup();
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
