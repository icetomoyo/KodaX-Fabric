/**
 * Enterprise isolation integration test.
 *
 * Run only against a migrated development/test database. Fixtures use a
 * unique marker and cleanup removes only rows created by this run.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import Fastify, { type LightMyRequestResponse } from "fastify";

const [
  { db, sql },
  { employees, enterprises, opsAuditLogs },
  { authRoutes },
  { adminUserRoutes },
  { adminEnterpriseRoutes },
  { adminCredentialRoutes },
  { adminQuotaRoutes },
  { hashPassword },
  { signSession },
  { insertEnterprise },
] = await Promise.all([
  import("../src/db/client.js"),
  import("../src/db/schema/index.js"),
  import("../src/routes/auth.js"),
  import("../src/routes/admin/users.js"),
  import("../src/routes/admin/enterprises.js"),
  import("../src/routes/admin/credentials.js"),
  import("../src/routes/admin/quota.js"),
  import("../src/lib/password.js"),
  import("../src/lib/jwt.js"),
  import("../src/lib/enterprise.js"),
]);

const marker = randomUUID().replaceAll("-", "").slice(0, 10);
const enterpriseXName = `企业X-${marker}`;
const enterpriseYName = `企业Y-${marker}`;
const createdName = `企业Z-${marker}`;
const employeeIds: number[] = [];
const enterpriseIds: number[] = [];
const app = Fastify({ logger: false });

function json<T>(response: LightMyRequestResponse): T {
  assert.match(String(response.headers["content-type"] ?? ""), /application\/json/i);
  return response.json<T>();
}

async function createEnterprise(name: string) {
  const row = await insertEnterprise({ name, status: "active" });
  enterpriseIds.push(row.id);
  return row;
}

async function createActiveUser(
  role: "employee" | "admin" | "org_admin",
  phone: string,
  enterpriseId: number,
) {
  const name = `${role}-${marker}`;
  const [row] = await db
    .insert(employees)
    .values({
      name,
      phone,
      passwordHash: await hashPassword(`EnterpriseTest@${marker}`),
      dept: `dept-${marker}`,
      role,
      status: "active",
      enterpriseId,
      mustChangePassword: false,
    })
    .returning({ id: employees.id });
  employeeIds.push(row.id);

  return {
    id: row.id,
    name,
    phone,
    enterpriseId,
    headers: {
      authorization: `Bearer ${await signSession({
        sub: String(row.id),
        role,
        phone,
        name,
        mustChangePassword: false,
        enterpriseId,
      })}`,
    },
  };
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
    await db
      .delete(opsAuditLogs)
      .where(
        and(
          eq(opsAuditLogs.targetType, "enterprise"),
          inArray(opsAuditLogs.targetId, enterpriseIds.map(String)),
        ),
      );
    await db.delete(enterprises).where(inArray(enterprises.id, enterpriseIds));
  }
}

async function main() {
  try {
    await cleanup();
    await app.register(authRoutes);
    await app.register(adminUserRoutes);
    await app.register(adminEnterpriseRoutes);
    await app.register(adminCredentialRoutes);
    await app.register(adminQuotaRoutes);
    await app.ready();

    const enterpriseX = await createEnterprise(enterpriseXName);
    const enterpriseY = await createEnterprise(enterpriseYName);
    const superAdmin = await createActiveUser("admin", `sa${marker}`, enterpriseX.id);
    const orgAdminX = await createActiveUser("org_admin", `ox${marker}`, enterpriseX.id);
    const employeeX = await createActiveUser("employee", `ex${marker}`, enterpriseX.id);
    const employeeY = await createActiveUser("employee", `ey${marker}`, enterpriseY.id);

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/enterprises",
      headers: superAdmin.headers,
      payload: { name: createdName },
    });
    assert.equal(created.statusCode, 200);
    const createdEnterprise = json<{
      success: true;
      data: { id: number; name: string; status: string };
    }>(created).data;
    enterpriseIds.push(createdEnterprise.id);
    assert.equal(createdEnterprise.name, createdName);
    assert.equal(createdEnterprise.status, "active");

    const listed = await app.inject({
      method: "GET",
      url: "/api/admin/enterprises",
      headers: superAdmin.headers,
    });
    assert.equal(listed.statusCode, 200);
    const enterprisesList = json<{
      success: true;
      data: Array<{ id: number; name: string; status: string }>;
    }>(listed).data;
    const listedCreated = enterprisesList.find((row) => row.id === createdEnterprise.id);
    assert.ok(listedCreated);
    assert.equal(listedCreated?.name, createdName);
    assert.equal(listedCreated?.status, "active");
    assert.ok(enterprisesList.some((row) => row.name === enterpriseXName));
    assert.ok(enterprisesList.some((row) => row.name === enterpriseYName));

    const orgAdminListEnterprises = await app.inject({
      method: "GET",
      url: "/api/admin/enterprises",
      headers: orgAdminX.headers,
    });
    assert.equal(orgAdminListEnterprises.statusCode, 403);

    const orgAdminCreateEnterprise = await app.inject({
      method: "POST",
      url: "/api/admin/enterprises",
      headers: orgAdminX.headers,
      payload: { name: `拒绝-${marker}` },
    });
    assert.equal(orgAdminCreateEnterprise.statusCode, 403);

    const orgAdminDisableY = await app.inject({
      method: "PATCH",
      url: `/api/admin/enterprises/${enterpriseY.id}/status`,
      headers: orgAdminX.headers,
      payload: { status: "disabled" },
    });
    assert.equal(orgAdminDisableY.statusCode, 403);

    const orgAdminUsers = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: orgAdminX.headers,
    });
    assert.equal(orgAdminUsers.statusCode, 200);
    const orgAdminUserRows = json<{
      success: true;
      data: Array<{ id: number; name: string; enterpriseId: number }>;
    }>(orgAdminUsers).data;
    assert.equal(orgAdminUserRows.every((row) => row.enterpriseId === enterpriseX.id), true);
    assert.ok(orgAdminUserRows.some((row) => row.id === employeeX.id));
    assert.ok(orgAdminUserRows.some((row) => row.id === orgAdminX.id));
    assert.equal(orgAdminUserRows.some((row) => row.id === employeeY.id), false);
    assert.equal(orgAdminUserRows.some((row) => row.id === superAdmin.id), false);

    const listY = await app.inject({
      method: "GET",
      url: `/api/admin/users?enterpriseId=${enterpriseY.id}`,
      headers: orgAdminX.headers,
    });
    assert.equal(listY.statusCode, 403);

    const mutateY = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${employeeY.id}/status`,
      headers: orgAdminX.headers,
      payload: { status: "disabled" },
    });
    assert.equal(mutateY.statusCode, 403);

    const credentialsDenied = await app.inject({
      method: "GET",
      url: "/api/admin/credentials",
      headers: orgAdminX.headers,
    });
    assert.equal(credentialsDenied.statusCode, 403);

    const quotaDenied = await app.inject({
      method: "GET",
      url: "/api/admin/quota-policy",
      headers: orgAdminX.headers,
    });
    assert.equal(quotaDenied.statusCode, 403);

    const createdByOrgAdmin = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: orgAdminX.headers,
      payload: {
        name: `新员工-${marker}`,
        phone: `nx${marker}`,
        password: `EnterpriseTest@${marker}`,
        role: "employee",
      },
    });
    assert.equal(createdByOrgAdmin.statusCode, 200);
    const newUser = json<{
      success: true;
      data: { id: number; name: string; enterpriseId: number };
    }>(createdByOrgAdmin).data;
    employeeIds.push(newUser.id);
    assert.equal(newUser.enterpriseId, enterpriseX.id);

    const orgAdminUsersAfter = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: orgAdminX.headers,
    });
    const orgAdminAfterRows = json<{
      success: true;
      data: Array<{ id: number; enterpriseId: number }>;
    }>(orgAdminUsersAfter).data;
    assert.ok(orgAdminAfterRows.some((row) => row.id === newUser.id));

    const superAdminYUsers = await app.inject({
      method: "GET",
      url: `/api/admin/users?enterpriseId=${enterpriseY.id}`,
      headers: superAdmin.headers,
    });
    assert.equal(superAdminYUsers.statusCode, 200);
    const yUsers = json<{ success: true; data: Array<{ id: number }> }>(superAdminYUsers).data;
    assert.ok(yUsers.some((row) => row.id === employeeY.id));
    assert.equal(yUsers.some((row) => row.id === newUser.id), false);

    const superAdminAll = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: superAdmin.headers,
    });
    const allUsers = json<{ success: true; data: Array<{ id: number; enterpriseId: number }> }>(
      superAdminAll,
    ).data;
    assert.ok(allUsers.some((row) => row.id === employeeX.id));
    assert.ok(allUsers.some((row) => row.id === employeeY.id));
    assert.ok(allUsers.some((row) => row.id === newUser.id));

    const bindAdmin = await app.inject({
      method: "POST",
      url: `/api/admin/enterprises/${enterpriseY.id}/admins`,
      headers: superAdmin.headers,
      payload: { employeeId: employeeY.id },
    });
    assert.equal(bindAdmin.statusCode, 200);
    assert.equal(json<{ data: { role: string; enterpriseId: number } }>(bindAdmin).data.role, "org_admin");
    assert.equal(json<{ data: { role: string; enterpriseId: number } }>(bindAdmin).data.enterpriseId, enterpriseY.id);

    console.log("enterprise isolation integration passed", {
      createdEnterprise: createdEnterprise.name,
      createdStatus: createdEnterprise.status,
      orgAdminSawOnlyX: true,
      orgAdminDeniedYAndPlatform: true,
      createdUserStayedInX: true,
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
