/**
 * Super-admin create-then-list launch against the real buildApp entry.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inArray, or } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";

const [
  { buildApp },
  { db, sql },
  { employees, enterprises, opsAuditLogs },
  { hashPassword },
  { signSession },
] = await Promise.all([
  import("../src/app.js"),
  import("../src/db/client.js"),
  import("../src/db/schema/index.js"),
  import("../src/lib/password.js"),
  import("../src/lib/jwt.js"),
]);

const marker = randomUUID().replaceAll("-", "").slice(0, 10);
const enterpriseName = `上线企业-${marker}`;
const employeeIds: number[] = [];
const enterpriseIds: number[] = [];

function json<T>(response: LightMyRequestResponse): T {
  assert.match(String(response.headers["content-type"] ?? ""), /application\/json/i);
  return response.json<T>();
}

async function cleanup() {
  if (employeeIds.length) {
    const ids = employeeIds.map(String);
    await db
      .delete(opsAuditLogs)
      .where(or(inArray(opsAuditLogs.actorEmployeeId, employeeIds), inArray(opsAuditLogs.targetId, ids)));
    await db.delete(employees).where(inArray(employees.id, employeeIds));
  }
  if (enterpriseIds.length) {
    await db.delete(enterprises).where(inArray(enterprises.id, enterpriseIds));
  }
}

async function main() {
  const app = await buildApp();
  try {
    await app.ready();

    const [hostEnterprise] = await db
      .select({ id: enterprises.id })
      .from(enterprises)
      .limit(1);
    assert.ok(hostEnterprise, "expected a backfilled default enterprise");

    const phone = `ln${marker}`;
    const [admin] = await db
      .insert(employees)
      .values({
        name: `launch-admin-${marker}`,
        phone,
        passwordHash: await hashPassword(`LaunchTest@${marker}`),
        role: "admin",
        status: "active",
        enterpriseId: hostEnterprise.id,
        mustChangePassword: false,
      })
      .returning({ id: employees.id });
    employeeIds.push(admin.id);

    const headers = {
      authorization: `Bearer ${await signSession({
        sub: String(admin.id),
        role: "admin",
        phone,
        name: `launch-admin-${marker}`,
        mustChangePassword: false,
        enterpriseId: hostEnterprise.id,
      })}`,
    };

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/enterprises",
      headers,
      payload: { name: enterpriseName },
    });
    assert.equal(created.statusCode, 200);
    const createdEnterprise = json<{
      success: true;
      data: { id: number; name: string; status: string };
    }>(created).data;
    enterpriseIds.push(createdEnterprise.id);
    assert.equal(createdEnterprise.name, enterpriseName);
    assert.equal(createdEnterprise.status, "active");

    const listed = await app.inject({
      method: "GET",
      url: "/api/admin/enterprises",
      headers,
    });
    assert.equal(listed.statusCode, 200);
    const rows = json<{
      success: true;
      data: Array<{ id: number; name: string; status: string }>;
    }>(listed).data;
    const found = rows.find((row) => row.id === createdEnterprise.id);
    assert.ok(found);
    assert.equal(found?.name, enterpriseName);
    assert.equal(found?.status, "active");

    console.log("enterprise launch passed", {
      name: found?.name,
      status: found?.status,
      count: rows.length,
    });
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
