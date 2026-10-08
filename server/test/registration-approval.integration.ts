/**
 * Explicit registration-approval integration test.
 *
 * Run only against a migrated development/test database. Fixtures use a
 * unique marker and cleanup removes only rows created by this run.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray, or } from "drizzle-orm";
import Fastify, { type LightMyRequestResponse } from "fastify";

const [
  { db, sql },
  { departments, employees, enterprises, opsAuditLogs, teamMembers, teams },
  { authRoutes },
  { meRoutes },
  { REGISTRATION_INITIAL_PASSWORD },
  { insertEnterprise },
] = await Promise.all([
  import("../src/db/client.js"),
  import("../src/db/schema/index.js"),
  import("../src/routes/auth.js"),
  import("../src/routes/me.js"),
  import("../src/lib/password.js"),
  import("../src/lib/enterprise.js"),
]);

const marker = randomUUID().replaceAll("-", "").slice(0, 10);
const applicantPhone = `rg${marker}`;
const employeeIds: number[] = [];
const enterpriseIds: number[] = [];
const app = Fastify({ logger: false });

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
    const deptRows = await db
      .select({ id: departments.id })
      .from(departments)
      .where(inArray(departments.enterpriseId, enterpriseIds));
    const deptIds = deptRows.map((row) => row.id);
    if (deptIds.length) {
      const teamRows = await db
        .select({ id: teams.id })
        .from(teams)
        .where(inArray(teams.departmentId, deptIds));
      const teamIds = teamRows.map((row) => row.id);
      if (teamIds.length) {
        await db.delete(teamMembers).where(inArray(teamMembers.teamId, teamIds));
        await db.delete(teams).where(inArray(teams.id, teamIds));
      }
      await db.delete(departments).where(inArray(departments.id, deptIds));
    }
    await db.delete(enterprises).where(inArray(enterprises.id, enterpriseIds));
  }
}

async function main() {
  try {
    await cleanup();
    await app.register(authRoutes);
    await app.register(meRoutes);
    await app.ready();

    const registration = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        name: `申请人-${marker}`,
        phone: applicantPhone,
        password: REGISTRATION_INITIAL_PASSWORD,
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
      payload: { name: "重复申请", phone: applicantPhone, password: REGISTRATION_INITIAL_PASSWORD },
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
    assert.equal(personalSession.user.mustChangePassword, false);
    assert.equal(personalSession.user.enterpriseId, null);

    const host = await insertEnterprise({ name: `加入企业-${marker}`, status: "active" });
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
    assert.equal(joinOk.statusCode, 403);

    const [member] = await db
      .select({ enterpriseId: employees.enterpriseId })
      .from(employees)
      .where(eq(employees.id, personal.id));
    assert.equal(member?.enterpriseId, null);

    const applyClosed = await app.inject({
      method: "POST",
      url: "/api/me/enterprise-applications",
      headers: { authorization: `Bearer ${afterPassword.token}` },
      payload: { name: `待审企业-${marker}` },
    });
    assert.equal(applyClosed.statusCode, 403);

    console.log("registration approval integration passed", {
      personalActiveWithoutEnterprise: true,
      joinByEnterpriseCodeClosed: true,
      enterpriseApplicationsClosed: true,
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
