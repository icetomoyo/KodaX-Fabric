import { eq, isNotNull } from "drizzle-orm";
import { env } from "../config.js";
import { db } from "../db/client.js";
import { departments, employees, teamMembers } from "../db/schema/index.js";
import {
  dingtalkOrgEmployeePatch,
  fetchDingtalkAccessToken,
  fetchDingtalkUser,
  fetchDingtalkUseridByUnionid,
  readDingtalkCredentials,
  type DingtalkUserDetail,
} from "./dingtalk-department-tree.js";
import {
  exchangeDingtalkUserAccessToken,
  fetchDingtalkOauthContactMe,
} from "./dingtalk-oauth.js";
import { ensureDefaultTeam } from "./enterprise.js";
import {
  planLdapDingtalkProvision,
  type MappedDingtalkDepartment,
} from "./ldap-dingtalk-provision.js";
import { writeOpsAudit } from "./ops-audit.js";
import { hashPassword, REGISTRATION_INITIAL_PASSWORD } from "./password.js";
import { normalizeDingtalkMobile } from "./dingtalk-user-import.js";
import {
  applyRegisterDingtalkJoin,
  planRegisterDingtalkJoin,
} from "./dingtalk-register-join.js";

type FetchImpl = typeof fetch;

export type DingtalkLoginEmployeeRow = {
  id: number;
  dingtalkUserid: string | null;
  phone: string;
  status: string;
};

export type DingtalkLoginMatch =
  | { kind: "userid"; employeeId: number }
  | { kind: "phone"; employeeId: number }
  | { kind: "provision" }
  | { kind: "none" };

export function matchPendingDingtalkEmployee(
  match: DingtalkLoginMatch,
  pendingEmployeeId: number | undefined,
): { ok: true } | { ok: false } {
  if (pendingEmployeeId == null) return { ok: true };
  if (match.kind === "userid" || match.kind === "phone") {
    return match.employeeId === pendingEmployeeId ? { ok: true } : { ok: false };
  }
  return { ok: false };
}

export function planDingtalkLoginMatch(
  profile: { userid: string; name: string; mobile: string | null },
  directory: readonly DingtalkLoginEmployeeRow[],
): DingtalkLoginMatch {
  const userid = profile.userid.trim();
  if (userid) {
    const byUserid = directory.find((row) => row.dingtalkUserid === userid);
    if (byUserid) return { kind: "userid", employeeId: byUserid.id };
  }
  const phone = normalizeDingtalkMobile(profile.mobile);
  if (phone) {
    const byPhone = directory.find((row) => row.phone === phone);
    if (byPhone) return { kind: "phone", employeeId: byPhone.id };
  }
  if (profile.name.trim() && phone) return { kind: "provision" };
  return { kind: "none" };
}

export type DingtalkLoginResolve =
  | { status: "ok"; user: typeof employees.$inferSelect }
  | { status: "oauth_failed" }
  | { status: "not_in_corp" }
  | { status: "not_linked" }
  | { status: "pending_mismatch" };

export async function resolveDingtalkLoginEmployee(options: {
  code: string;
  fetchImpl?: FetchImpl;
  ip?: string;
  pendingEmployeeId?: number;
}): Promise<DingtalkLoginResolve> {
  const credentials = readDingtalkCredentials(env);
  if (!credentials) return { status: "oauth_failed" };
  const fetchImpl = options.fetchImpl;

  const userToken = await exchangeDingtalkUserAccessToken({
    clientId: credentials.appKey,
    clientSecret: credentials.appSecret,
    code: options.code,
    fetchImpl,
  });
  if (!userToken.ok) return { status: "oauth_failed" };

  const me = await fetchDingtalkOauthContactMe({
    userAccessToken: userToken.accessToken,
    fetchImpl,
  });
  if (!me.ok) return { status: "oauth_failed" };

  const appToken = await fetchDingtalkAccessToken({
    appKey: credentials.appKey,
    appSecret: credentials.appSecret,
    fetchImpl,
  });
  const union = await fetchDingtalkUseridByUnionid({
    token: appToken,
    unionid: me.unionId,
    fetchImpl,
  });
  if (!union) return { status: "not_in_corp" };

  const profile = await fetchDingtalkUser({
    token: appToken,
    userid: union.userid,
    fetchImpl,
  });
  if (!profile) return { status: "not_in_corp" };

  const directory = await db
    .select({
      id: employees.id,
      dingtalkUserid: employees.dingtalkUserid,
      phone: employees.phone,
      status: employees.status,
    })
    .from(employees);
  const match = planDingtalkLoginMatch(
    {
      userid: profile.userid,
      name: profile.name,
      mobile: profile.mobile ?? me.mobile,
    },
    directory,
  );
  if (!matchPendingDingtalkEmployee(match, options.pendingEmployeeId).ok) {
    return { status: "pending_mismatch" };
  }

  if (match.kind === "userid" || match.kind === "phone") {
    const [user] = await db.select().from(employees).where(eq(employees.id, match.employeeId)).limit(1);
    if (!user) return { status: "not_linked" };
    await attachDingtalkProfile(user.id, profile);
    if (user.enterpriseId == null) {
      await tryJoinFromProfile(user.id, profile);
    }
    const [fresh] = await db.select().from(employees).where(eq(employees.id, user.id)).limit(1);
    return { status: "ok", user: fresh ?? user };
  }

  if (match.kind !== "provision") return { status: "not_linked" };
  const provisioned = await provisionFromProfile(profile, { ip: options.ip });
  if (!provisioned) return { status: "not_linked" };
  return { status: "ok", user: provisioned };
}

async function attachDingtalkProfile(employeeId: number, profile: DingtalkUserDetail): Promise<void> {
  await db
    .update(employees)
    .set({
      isDingtalk: true,
      ...dingtalkOrgEmployeePatch(profile),
      updatedAt: new Date(),
    })
    .where(eq(employees.id, employeeId));
}

async function tryJoinFromProfile(employeeId: number, profile: DingtalkUserDetail): Promise<void> {
  const mapped = await loadMappedDepartments();
  const plan = planRegisterDingtalkJoin({ status: "found", profile }, mapped);
  if (plan.status !== "matched") return;
  await applyRegisterDingtalkJoin(employeeId, plan);
}

async function provisionFromProfile(
  profile: DingtalkUserDetail,
  options: { ip?: string },
): Promise<typeof employees.$inferSelect | null> {
  const mapped = await loadMappedDepartments();
  const plan = planLdapDingtalkProvision(profile, mapped);
  if (!plan) return null;
  const existing = await db.select().from(employees).where(eq(employees.phone, plan.phone)).limit(1);
  if (existing[0]) return existing[0];

  const passwordHash = await hashPassword(REGISTRATION_INITIAL_PASSWORD);
  try {
    const [row] = await db
      .insert(employees)
      .values({
        name: plan.name,
        phone: plan.phone,
        passwordHash,
        dept: plan.departmentName,
        role: "employee",
        status: "active",
        enterpriseId: plan.enterpriseId,
        mustChangePassword: false,
        isDingtalk: true,
        ...dingtalkOrgEmployeePatch(profile),
      })
      .returning();
    const teamId = await ensureDefaultTeam(plan.departmentId, plan.enterpriseId);
    await db.insert(teamMembers).values({
      teamId,
      employeeId: row.id,
    });
    await writeOpsAudit({
      actorEmployeeId: row.id,
      action: "user.dingtalk_provision",
      targetType: "employee",
      targetId: String(row.id),
      detail: {
        userid: plan.userid,
        name: plan.name,
        phone: plan.phone,
        departmentId: plan.departmentId,
        enterpriseId: plan.enterpriseId,
      },
      ip: options.ip,
    });
    return row;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("employees_phone_uidx") || message.includes("unique")) {
      const [row] = await db.select().from(employees).where(eq(employees.phone, plan.phone)).limit(1);
      return row ?? null;
    }
    throw error;
  }
}

async function loadMappedDepartments(): Promise<MappedDingtalkDepartment[]> {
  const mappedRows = await db
    .select({
      id: departments.id,
      name: departments.name,
      enterpriseId: departments.enterpriseId,
      dingtalkDeptId: departments.dingtalkDeptId,
    })
    .from(departments)
    .where(isNotNull(departments.dingtalkDeptId));
  return mappedRows.flatMap((row) =>
    row.dingtalkDeptId == null
      ? []
      : [
          {
            dingtalkDeptId: row.dingtalkDeptId,
            departmentId: row.id,
            enterpriseId: row.enterpriseId,
            departmentName: row.name,
          },
        ],
  );
}
