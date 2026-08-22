/**
 * Explicit registration-approval integration test.
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
  { meRoutes },
  { hashPassword, REGISTRATION_INITIAL_PASSWORD },
  { signSession },
  { getDefaultEnterpriseId },
] = await Promise.all([
  import("../src/db/client.js"),
  import("../src/db/schema/index.js"),
  import("../src/routes/auth.js"),
  import("../src/routes/admin/users.js"),
  import("../src/routes/admin/enterprises.js"),
  import("../src/routes/me.js"),
  import("../src/lib/password.js"),
  import("../src/lib/jwt.js"),
  import("../src/lib/enterprise.js"),
]);

const marker = randomUUID().replaceAll("-", "").slice(0, 10);
const applicantPhone = `rg${marker}`;
const adminPhone = `ra${marker}`;
const employeePhone = `re${marker}`;
const employeeIds: number[] = [];
const enterpriseIds: number[] = [];
const app = Fastify({ logger: false });

function json<T>(response: LightMyRequestResponse): T {
  assert.match(String(response.headers["content-type"] ?? ""), /application\/json/i);
  return response.json<T>();
}

async function createActiveUser(role: "employee" | "admin", phone: string) {
  const name = `${role}-${marker}`;
  const enterpriseId = await getDefaultEnterpriseId();
  const [row] = await db
    .insert(employees)
    .values({
      name,
      phone,
      passwordHash: await hashPassword(`RegistrationTest@${marker}`),
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
    await db.delete(enterprises).where(inArray(enterprises.id, enterpriseIds));
  }
}

async function main() {
  try {
    await cleanup();
    await app.register(authRoutes);
    await app.register(adminUserRoutes);
    await app.register(adminEnterpriseRoutes);
    await app.register(meRoutes);
    await app.ready();

    const registration = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        kind: "personal",
        name: `申请人-${marker}`,
        dept: `研发-${marker}`,
        phone: applicantPhone,
      },
    });
    assert.equal(registration.statusCode, 200);
    const personal = json<{
      success: true;
      data: { id: number; phone: string; status: string; enterpriseId: number | null };
    }>(registration).data;
    employeeIds.push(personal.id);
    assert.equal(personal.phone, applicantPhone);
    assert.equal(personal.status, "active");
    assert.equal(personal.enterpriseId, null);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { kind: "personal", name: "重复申请", dept: "研发", phone: applicantPhone },
    });
    assert.equal(duplicate.statusCode, 409);

    const personalLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { phone: applicantPhone, password: REGISTRATION_INITIAL_PASSWORD },
    });
    assert.equal(personalLogin.statusCode, 200);
    const personalSession = json<{
      data: { token: string; user: { mustChangePassword: boolean; enterpriseId: number | null } };
    }>(personalLogin).data;
    assert.equal(personalSession.user.mustChangePassword, true);
    assert.equal(personalSession.user.enterpriseId, null);

    const admin = await createActiveUser("admin", adminPhone);
    const createdEnterprise = await app.inject({
      method: "POST",
      url: "/api/admin/enterprises",
      headers: admin.headers,
      payload: { name: `加入企业-${marker}` },
    });
    assert.equal(createdEnterprise.statusCode, 200);
    const host = json<{ data: { id: number; code: string; name: string; status: string } }>(
      createdEnterprise,
    ).data;
    enterpriseIds.push(host.id);
    assert.equal(host.status, "active");
    assert.match(host.code, /^E/);

    const joinDenied = await app.inject({
      method: "POST",
      url: "/api/me/join-enterprise",
      headers: { authorization: `Bearer ${personalSession.token}` },
      payload: { code: host.code },
    });
    assert.equal(joinDenied.statusCode, 403);

    const joined = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { authorization: `Bearer ${personalSession.token}` },
      payload: { oldPassword: REGISTRATION_INITIAL_PASSWORD, newPassword: `JoinTest@${marker}1` },
    });
    assert.equal(joined.statusCode, 200);
    const afterPassword = json<{ data: { token: string } }>(joined).data;
    const joinOk = await app.inject({
      method: "POST",
      url: "/api/me/join-enterprise",
      headers: { authorization: `Bearer ${afterPassword.token}` },
      payload: { code: host.code },
    });
    assert.equal(joinOk.statusCode, 200);
    assert.equal(json<{ data: { enterprise: { id: number } } }>(joinOk).data.enterprise.id, host.id);

    const [member] = await db
      .select({ enterpriseId: employees.enterpriseId })
      .from(employees)
      .where(eq(employees.id, personal.id));
    assert.equal(member?.enterpriseId, host.id);

    const enterprisePhone = `en${marker}`;
    const enterpriseReg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        kind: "enterprise",
        name: `企业联系人-${marker}`,
        phone: enterprisePhone,
        enterpriseName: `待审企业-${marker}`,
      },
    });
    assert.equal(enterpriseReg.statusCode, 200);
    const enterpriseApp = json<{
      data: { id: number; status: string; enterprise: { id: number; status: string; code: string } };
    }>(enterpriseReg).data;
    employeeIds.push(enterpriseApp.id);
    enterpriseIds.push(enterpriseApp.enterprise.id);
    assert.equal(enterpriseApp.status, "pending");
    assert.equal(enterpriseApp.enterprise.status, "pending");

    const pendingEnterpriseLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { phone: enterprisePhone, password: REGISTRATION_INITIAL_PASSWORD },
    });
    assert.equal(pendingEnterpriseLogin.statusCode, 403);
    assert.equal(json<{ code: string }>(pendingEnterpriseLogin).code, "REGISTRATION_PENDING");

    const enable = await app.inject({
      method: "PATCH",
      url: `/api/admin/enterprises/${enterpriseApp.enterprise.id}/status`,
      headers: admin.headers,
      payload: { status: "active" },
    });
    assert.equal(enable.statusCode, 200);

    const orgAdminLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { phone: enterprisePhone, password: REGISTRATION_INITIAL_PASSWORD },
    });
    assert.equal(orgAdminLogin.statusCode, 200);
    assert.equal(json<{ data: { user: { role: string } } }>(orgAdminLogin).data.user.role, "org_admin");

    console.log("registration approval integration passed", {
      personalActiveWithoutEnterprise: true,
      joinByEnterpriseCode: true,
      enterprisePendingUntilSuperAdmin: true,
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
