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
  { employees, opsAuditLogs },
  { authRoutes },
  { adminUserRoutes },
  { hashPassword, REGISTRATION_INITIAL_PASSWORD, verifyPassword },
  { signSession },
] = await Promise.all([
  import("../src/db/client.js"),
  import("../src/db/schema/index.js"),
  import("../src/routes/auth.js"),
  import("../src/routes/admin/users.js"),
  import("../src/lib/password.js"),
  import("../src/lib/jwt.js"),
]);

const marker = randomUUID().replaceAll("-", "").slice(0, 10);
const applicantPhone = `rg${marker}`;
const adminPhone = `ra${marker}`;
const employeePhone = `re${marker}`;
const employeeIds: number[] = [];
const app = Fastify({ logger: false });

function json<T>(response: LightMyRequestResponse): T {
  assert.match(String(response.headers["content-type"] ?? ""), /application\/json/i);
  return response.json<T>();
}

async function createActiveUser(role: "employee" | "admin", phone: string) {
  const name = `${role}-${marker}`;
  const [row] = await db
    .insert(employees)
    .values({
      name,
      phone,
      passwordHash: await hashPassword(`RegistrationTest@${marker}`),
      dept: `dept-${marker}`,
      role,
      status: "active",
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
      })}`,
    },
  };
}

async function cleanup() {
  if (!employeeIds.length) return;
  const ids = employeeIds.map(String);
  await db
    .delete(opsAuditLogs)
    .where(or(inArray(opsAuditLogs.actorEmployeeId, employeeIds), inArray(opsAuditLogs.targetId, ids)));
  await db.delete(employees).where(inArray(employees.id, employeeIds));
}

async function main() {
  try {
    await cleanup();
    await app.register(authRoutes);
    await app.register(adminUserRoutes);
    await app.ready();

    const registration = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        name: `申请人-${marker}`,
        dept: `研发-${marker}`,
        phone: applicantPhone,
      },
    });
    assert.equal(registration.statusCode, 200);
    const application = json<{
      success: true;
      data: { id: number; name: string; dept: string; phone: string; status: string };
    }>(registration).data;
    employeeIds.push(application.id);
    assert.equal(application.phone, applicantPhone);
    assert.equal(application.status, "pending");

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { name: "重复申请", dept: "研发", phone: applicantPhone },
    });
    assert.equal(duplicate.statusCode, 409);

    const pendingLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { phone: applicantPhone, password: REGISTRATION_INITIAL_PASSWORD },
    });
    assert.equal(pendingLogin.statusCode, 403);
    assert.equal(json<{ code: string }>(pendingLogin).code, "REGISTRATION_PENDING");

    const admin = await createActiveUser("admin", adminPhone);
    const employee = await createActiveUser("employee", employeePhone);

    const visibleApplications = await app.inject({
      method: "GET",
      url: `/api/admin/users?status=pending&q=${encodeURIComponent(applicantPhone)}`,
      headers: admin.headers,
    });
    assert.equal(visibleApplications.statusCode, 200);
    const applications = json<{
      success: true;
      data: Array<{ id: number; name: string; dept: string; phone: string; status: string; createdAt: string }>;
    }>(visibleApplications).data;
    assert.equal(applications.length, 1);
    assert.deepEqual(
      {
        id: applications[0]?.id,
        name: applications[0]?.name,
        dept: applications[0]?.dept,
        phone: applications[0]?.phone,
        status: applications[0]?.status,
      },
      {
        id: application.id,
        name: `申请人-${marker}`,
        dept: `研发-${marker}`,
        phone: applicantPhone,
        status: "pending",
      },
    );
    assert.ok(applications[0]?.createdAt);

    const employeeDenied = await app.inject({
      method: "POST",
      url: `/api/admin/users/${application.id}/approve`,
      headers: employee.headers,
    });
    assert.equal(employeeDenied.statusCode, 403);

    const bypassAttempt = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${application.id}`,
      headers: admin.headers,
      payload: { status: "active" },
    });
    assert.equal(bypassAttempt.statusCode, 400);

    const approval = await app.inject({
      method: "POST",
      url: `/api/admin/users/${application.id}/approve`,
      headers: admin.headers,
    });
    assert.equal(approval.statusCode, 200);
    assert.equal(json<{ data: { status: string; mustChangePassword: boolean } }>(approval).data.status, "active");
    assert.equal(json<{ data: { status: string; mustChangePassword: boolean } }>(approval).data.mustChangePassword, true);

    const secondApproval = await app.inject({
      method: "POST",
      url: `/api/admin/users/${application.id}/approve`,
      headers: admin.headers,
    });
    assert.equal(secondApproval.statusCode, 409);

    const [approvedEmployee] = await db
      .select({
        role: employees.role,
        status: employees.status,
        passwordHash: employees.passwordHash,
        mustChangePassword: employees.mustChangePassword,
      })
      .from(employees)
      .where(eq(employees.id, application.id));
    assert.equal(approvedEmployee?.role, "employee");
    assert.equal(approvedEmployee?.status, "active");
    assert.equal(approvedEmployee?.mustChangePassword, true);
    assert.equal(
      await verifyPassword(REGISTRATION_INITIAL_PASSWORD, approvedEmployee?.passwordHash ?? ""),
      true,
    );

    const approvedLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { phone: applicantPhone, password: REGISTRATION_INITIAL_PASSWORD },
    });
    assert.equal(approvedLogin.statusCode, 200);
    assert.equal(json<{ data: { user: { mustChangePassword: boolean } } }>(approvedLogin).data.user.mustChangePassword, true);

    const audits = await db
      .select({ action: opsAuditLogs.action })
      .from(opsAuditLogs)
      .where(
        and(
          eq(opsAuditLogs.targetId, String(application.id)),
          inArray(opsAuditLogs.action, ["auth.register_application", "user.registration_approve"]),
        ),
      );
    assert.deepEqual(
      new Set(audits.map((row) => row.action)),
      new Set(["auth.register_application", "user.registration_approve"]),
    );

    console.log("registration approval integration passed", {
      pendingLoginBlocked: true,
      adminApprovalRequired: true,
      initialPasswordForcedChange: true,
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
