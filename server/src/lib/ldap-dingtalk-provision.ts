import { eq, isNotNull } from "drizzle-orm";
import { env } from "../config.js";
import { db } from "../db/client.js";
import { departments, employees, teamMembers } from "../db/schema/index.js";
import { ensureDefaultTeam } from "./enterprise.js";
import {
  fetchDingtalkAccessToken,
  fetchDingtalkContactUseridsByName,
  fetchDingtalkUser,
  readDingtalkCredentials,
  type DingtalkUserDetail,
} from "./dingtalk-department-tree.js";
import { normalizeDingtalkMobile } from "./dingtalk-user-import.js";
import type { LdapEmployeeMatch, LdapPerson } from "./ldap-auth.js";
import { writeOpsAudit } from "./ops-audit.js";
import { hashPassword, REGISTRATION_INITIAL_PASSWORD } from "./password.js";

export type MappedDingtalkDepartment = {
  dingtalkDeptId: number;
  departmentId: number;
  enterpriseId: number;
  departmentName: string;
};

export type LdapDingtalkProvisionPlan = {
  name: string;
  phone: string;
  departmentId: number;
  enterpriseId: number;
  departmentName: string;
  userid: string;
};

type FetchImpl = typeof fetch;

export function planLdapDingtalkProvision(
  profile: DingtalkUserDetail,
  mapped: readonly MappedDingtalkDepartment[],
): LdapDingtalkProvisionPlan | null {
  const name = profile.name.trim();
  const phone = normalizeDingtalkMobile(profile.mobile);
  if (!name || !phone || phone.length < 5 || phone.length > 20) return null;
  const byDingId = new Map(mapped.map((row) => [row.dingtalkDeptId, row]));
  const department = profile.deptIds.map((id) => byDingId.get(id)).find((row) => row != null);
  if (!department) return null;
  return {
    name: name.slice(0, 100),
    phone,
    departmentId: department.departmentId,
    enterpriseId: department.enterpriseId,
    departmentName: department.departmentName,
    userid: profile.userid,
  };
}

export async function lookupDingtalkProfileForLdapPerson(options: {
  person: Pick<LdapPerson, "displayName">;
  token: string;
  fetchImpl?: FetchImpl;
  oapiBaseUrl?: string;
  contactBaseUrl?: string;
}): Promise<DingtalkUserDetail | null> {
  const name = options.person.displayName?.trim();
  if (!name) return null;
  const userids = await fetchDingtalkContactUseridsByName({
    token: options.token,
    name,
    fetchImpl: options.fetchImpl,
    baseUrl: options.contactBaseUrl,
  });
  if (userids.length !== 1) return null;
  const profile = await fetchDingtalkUser({
    token: options.token,
    userid: userids[0]!,
    fetchImpl: options.fetchImpl,
    baseUrl: options.oapiBaseUrl,
  });
  if (!profile || profile.name.trim() !== name) return null;
  return profile;
}

export async function provisionEmployeeFromLdapDingtalk(
  person: LdapPerson,
  options?: { fetchImpl?: FetchImpl; ip?: string },
): Promise<LdapEmployeeMatch | null> {
  const credentials = readDingtalkCredentials(env);
  if (!credentials) return null;

  const mappedRows = await db
    .select({
      id: departments.id,
      name: departments.name,
      enterpriseId: departments.enterpriseId,
      dingtalkDeptId: departments.dingtalkDeptId,
    })
    .from(departments)
    .where(isNotNull(departments.dingtalkDeptId));
  const mapped: MappedDingtalkDepartment[] = mappedRows.flatMap((row) =>
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

  const token = await fetchDingtalkAccessToken({
    appKey: credentials.appKey,
    appSecret: credentials.appSecret,
    fetchImpl: options?.fetchImpl,
  });
  const profile = await lookupDingtalkProfileForLdapPerson({
    person,
    token,
    fetchImpl: options?.fetchImpl,
  });
  if (!profile) return null;
  const plan = planLdapDingtalkProvision(profile, mapped);
  if (!plan) return null;

  const existing = await findEmployeeByPhone(plan.phone);
  if (existing) return existing;

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
      })
      .returning({
        id: employees.id,
        name: employees.name,
        phone: employees.phone,
      });
    const teamId = await ensureDefaultTeam(plan.departmentId, plan.enterpriseId);
    await db.insert(teamMembers).values({
      teamId,
      employeeId: row.id,
      role: "member",
    });
    await writeOpsAudit({
      actorEmployeeId: row.id,
      action: "user.ldap_provision",
      targetType: "employee",
      targetId: String(row.id),
      detail: {
        userid: plan.userid,
        name: plan.name,
        phone: plan.phone,
        departmentId: plan.departmentId,
        enterpriseId: plan.enterpriseId,
        ldapUid: person.uid,
      },
      ip: options?.ip,
    });
    return row;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("employees_phone_uidx") || message.includes("unique")) {
      return findEmployeeByPhone(plan.phone);
    }
    throw error;
  }
}

async function findEmployeeByPhone(phone: string): Promise<LdapEmployeeMatch | null> {
  const [row] = await db
    .select({
      id: employees.id,
      name: employees.name,
      phone: employees.phone,
    })
    .from(employees)
    .where(eq(employees.phone, phone))
    .limit(1);
  return row ?? null;
}
