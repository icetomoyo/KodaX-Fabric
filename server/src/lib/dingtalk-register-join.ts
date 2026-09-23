import { eq, isNotNull } from "drizzle-orm";
import { env } from "../config.js";
import { db } from "../db/client.js";
import { departments, employees, teamMembers } from "../db/schema/index.js";
import {
  fetchDingtalkAccessToken,
  fetchDingtalkContactUseridsByName,
  fetchDingtalkUser,
  fetchDingtalkUseridByMobile,
  readDingtalkCredentials,
  type DingtalkCredentials,
  type DingtalkUserDetail,
} from "./dingtalk-department-tree.js";
import { normalizeDingtalkMobile } from "./dingtalk-user-import.js";
import { ensureDefaultTeam } from "./enterprise.js";
import type { MappedDingtalkDepartment } from "./ldap-dingtalk-provision.js";

type FetchImpl = typeof fetch;

export type RegisterDingtalkLookup =
  | { status: "found"; profile: DingtalkUserDetail }
  | { status: "not_found" }
  | { status: "name_mismatch"; dingtalkName: string }
  | { status: "phone_mismatch" };

export type RegisterDingtalkJoinPlan =
  | {
      status: "matched";
      userid: string;
      enterpriseId: number;
      departments: MappedDingtalkDepartment[];
    }
  | { status: "not_found" }
  | { status: "name_mismatch"; dingtalkName: string }
  | { status: "phone_mismatch" }
  | { status: "unmapped" };

export type RegisterDingtalkJoinResult = RegisterDingtalkJoinPlan | { status: "not_configured" | "error" };

export const REGISTER_DINGTALK_JOIN_MESSAGES = {
  matched: (names: readonly string[]) =>
    `已根据钉钉通讯录加入「${names.join("、")}」。请登录。`,
  not_found:
    "未在钉钉通讯录中找到该姓名和手机号，未能自动加入部门。账号已注册，登录后可在 Token Bot 说出部门名加入。",
  name_mismatch: (dingtalkName: string) =>
    `钉钉中该手机号对应的是「${dingtalkName}」，与填写姓名不一致，未能自动加入部门。账号已注册，登录后可在 Token Bot 说出部门名加入。`,
  phone_mismatch:
    "钉钉中有同名员工，但手机号不一致，未能自动加入部门。账号已注册，登录后可在 Token Bot 说出部门名加入。",
  unmapped:
    "钉钉通讯录中找到了你，但部门尚未同步到本系统，未能自动加入部门。账号已注册，登录后可在 Token Bot 说出部门名加入。",
  not_configured:
    "暂时无法核对钉钉通讯录，账号已注册。登录后可在 Token Bot 说出部门名加入。",
  error:
    "核对钉钉通讯录失败，账号已注册。登录后可在 Token Bot 说出部门名加入。",
} as const;

export function registerDingtalkJoinMessage(result: RegisterDingtalkJoinResult): string {
  if (result.status === "matched") {
    return REGISTER_DINGTALK_JOIN_MESSAGES.matched(result.departments.map((row) => row.departmentName));
  }
  if (result.status === "name_mismatch") {
    return REGISTER_DINGTALK_JOIN_MESSAGES.name_mismatch(result.dingtalkName);
  }
  return REGISTER_DINGTALK_JOIN_MESSAGES[result.status];
}

export function planRegisterDingtalkJoin(
  lookup: RegisterDingtalkLookup,
  mapped: readonly MappedDingtalkDepartment[],
): RegisterDingtalkJoinPlan {
  if (lookup.status !== "found") return lookup;
  const byDingId = new Map(mapped.map((row) => [row.dingtalkDeptId, row]));
  const seen = new Set<number>();
  const departmentsForJoin: MappedDingtalkDepartment[] = [];
  let enterpriseId: number | null = null;
  for (const dingId of lookup.profile.deptIds) {
    const row = byDingId.get(dingId);
    if (!row) continue;
    if (enterpriseId == null) enterpriseId = row.enterpriseId;
    if (row.enterpriseId !== enterpriseId) continue;
    if (seen.has(row.departmentId)) continue;
    seen.add(row.departmentId);
    departmentsForJoin.push(row);
  }
  if (enterpriseId == null || departmentsForJoin.length === 0) {
    return { status: "unmapped" };
  }
  return {
    status: "matched",
    userid: lookup.profile.userid,
    enterpriseId,
    departments: departmentsForJoin,
  };
}

export async function lookupDingtalkProfileForRegister(options: {
  name: string;
  phone: string;
  token: string;
  fetchImpl?: FetchImpl;
  oapiBaseUrl?: string;
  contactBaseUrl?: string;
}): Promise<RegisterDingtalkLookup> {
  const name = options.name.trim();
  const phone = normalizeDingtalkMobile(options.phone);
  if (!name || !phone) return { status: "not_found" };

  const fetchImpl = options.fetchImpl;
  const userid = await fetchDingtalkUseridByMobile({
    token: options.token,
    mobile: phone,
    fetchImpl,
    baseUrl: options.oapiBaseUrl,
  });
  if (userid) {
    const profile = await fetchDingtalkUser({
      token: options.token,
      userid,
      fetchImpl,
      baseUrl: options.oapiBaseUrl,
    });
    if (!profile) return { status: "not_found" };
    if (profile.name.trim() !== name) {
      return { status: "name_mismatch", dingtalkName: profile.name.trim() };
    }
    return { status: "found", profile };
  }

  const userids = await fetchDingtalkContactUseridsByName({
    token: options.token,
    name,
    fetchImpl,
    baseUrl: options.contactBaseUrl,
  });
  if (userids.length !== 1) return { status: "not_found" };
  const profile = await fetchDingtalkUser({
    token: options.token,
    userid: userids[0]!,
    fetchImpl,
    baseUrl: options.oapiBaseUrl,
  });
  if (!profile) return { status: "not_found" };
  const profilePhone = normalizeDingtalkMobile(profile.mobile);
  if (!profilePhone || profilePhone !== phone) return { status: "phone_mismatch" };
  if (profile.name.trim() !== name) {
    return { status: "name_mismatch", dingtalkName: profile.name.trim() };
  }
  return { status: "found", profile };
}

export async function tryJoinRegisteredEmployeeFromDingtalk(input: {
  employeeId: number;
  name: string;
  phone: string;
  fetchImpl?: FetchImpl;
  credentials?: DingtalkCredentials | null;
  mapped?: MappedDingtalkDepartment[];
}): Promise<RegisterDingtalkJoinResult> {
  const credentials =
    input.credentials === undefined ? readDingtalkCredentials(env) : input.credentials;
  if (!credentials) return { status: "not_configured" };

  try {
    const mapped = input.mapped ?? (await loadMappedDingtalkDepartments());
    const token = await fetchDingtalkAccessToken({
      appKey: credentials.appKey,
      appSecret: credentials.appSecret,
      fetchImpl: input.fetchImpl,
    });
    const lookup = await lookupDingtalkProfileForRegister({
      name: input.name,
      phone: input.phone,
      token,
      fetchImpl: input.fetchImpl,
    });
    const plan = planRegisterDingtalkJoin(lookup, mapped);
    if (plan.status !== "matched") return plan;
    await applyRegisterDingtalkJoin(input.employeeId, plan);
    return plan;
  } catch {
    return { status: "error" };
  }
}

async function loadMappedDingtalkDepartments(): Promise<MappedDingtalkDepartment[]> {
  const rows = await db
    .select({
      id: departments.id,
      name: departments.name,
      enterpriseId: departments.enterpriseId,
      dingtalkDeptId: departments.dingtalkDeptId,
    })
    .from(departments)
    .where(isNotNull(departments.dingtalkDeptId));
  return rows.flatMap((row) =>
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

async function applyRegisterDingtalkJoin(
  employeeId: number,
  plan: Extract<RegisterDingtalkJoinPlan, { status: "matched" }>,
): Promise<void> {
  const primary = plan.departments[0]!;
  await db
    .update(employees)
    .set({
      enterpriseId: plan.enterpriseId,
      dept: primary.departmentName,
      updatedAt: new Date(),
    })
    .where(eq(employees.id, employeeId));

  for (const department of plan.departments) {
    const teamId = await ensureDefaultTeam(department.departmentId, plan.enterpriseId);
    try {
      await db.insert(teamMembers).values({
        teamId,
        employeeId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("team_members_team_employee_uidx") || message.includes("unique")) {
        continue;
      }
      throw error;
    }
  }
}
