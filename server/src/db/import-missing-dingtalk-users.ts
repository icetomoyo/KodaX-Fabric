import { and, eq } from "drizzle-orm";
import "../config.js";
import { env } from "../config.js";
import { db } from "./client.js";
import { departments, employees, enterprises, teamMembers } from "./schema/index.js";
import { ensureDefaultTeam } from "../lib/enterprise.js";
import {
  collectDingtalkDeptIds,
  dingtalkOrgEmployeePatch,
  fetchDingtalkAccessToken,
  fetchDingtalkDepartmentTree,
  fetchDingtalkDeptUsers,
  fetchDingtalkUser,
  mergeDingtalkUserDetails,
  readDingtalkCredentials,
  type DingtalkUserDetail,
} from "../lib/dingtalk-department-tree.js";
import { normalizeDingtalkMobile } from "../lib/dingtalk-user-import.js";
import { hashPassword, REGISTRATION_INITIAL_PASSWORD } from "../lib/password.js";
import { writeOpsAudit } from "../lib/ops-audit.js";

const GROUP_NAME = "海致集团";
const KEJI_DING = 855501967;
const KEJI_OUTSOURCE = { name: "外包团队", dingtalkDeptId: 1093320169 };

async function main() {
  const [group] = await db.select().from(enterprises).where(eq(enterprises.name, GROUP_NAME)).limit(1);
  if (!group) throw new Error("缺少企业 海致集团");

  const [keji] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.dingtalkDeptId, KEJI_DING))
    .limit(1);
  if (!keji) throw new Error("缺少部门 海致科技");

  const [existingOutsource] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.dingtalkDeptId, KEJI_OUTSOURCE.dingtalkDeptId))
    .limit(1);
  let outsourceId = existingOutsource?.id;
  if (!outsourceId) {
    const [row] = await db
      .insert(departments)
      .values({
        enterpriseId: group.id,
        parentId: keji.id,
        name: KEJI_OUTSOURCE.name,
        dingtalkDeptId: KEJI_OUTSOURCE.dingtalkDeptId,
        status: "active",
        isDefault: false,
      })
      .returning({ id: departments.id });
    outsourceId = row.id;
    await ensureDefaultTeam(outsourceId, group.id);
    await writeOpsAudit({
      actorEmployeeId: 1,
      action: "department.create",
      targetType: "department",
      targetId: String(outsourceId),
      detail: { name: "外包团队", parent: "海致科技", dingtalkDeptId: KEJI_OUTSOURCE.dingtalkDeptId },
    });
  } else {
    await ensureDefaultTeam(outsourceId, group.id);
  }

  const credentials = readDingtalkCredentials(env);
  if (!credentials) throw new Error("未配置钉钉");
  const tree = await fetchDingtalkDepartmentTree(credentials);
  const token = await fetchDingtalkAccessToken(credentials);
  const byUserid = new Map<string, DingtalkUserDetail>();
  for (const deptId of collectDingtalkDeptIds(tree)) {
    const users = await fetchDingtalkDeptUsers({ token, deptId });
    for (const user of users) {
      const existing = byUserid.get(user.userid);
      byUserid.set(user.userid, existing ? mergeDingtalkUserDetails(existing, user) : user);
    }
  }

  const local = await db.select({
    id: employees.id,
    phone: employees.phone,
    dingtalkUserid: employees.dingtalkUserid,
  }).from(employees);
  const byPhone = new Map(local.map((row) => [row.phone, row]));
  const byDingUserid = new Map(
    local.filter((row) => row.dingtalkUserid).map((row) => [row.dingtalkUserid as string, row]),
  );

  const mappedDepts = await db
    .select({
      id: departments.id,
      enterpriseId: departments.enterpriseId,
      dingtalkDeptId: departments.dingtalkDeptId,
    })
    .from(departments);
  const deptByDing = new Map<number, { id: number; enterpriseId: number }>();
  for (const row of mappedDepts) {
    if (row.dingtalkDeptId != null) deptByDing.set(row.dingtalkDeptId, row);
  }
  const teamByDept = new Map<number, number>();
  async function teamIdFor(departmentId: number, enterpriseId: number) {
    const cached = teamByDept.get(departmentId);
    if (cached) return cached;
    const id = await ensureDefaultTeam(departmentId, enterpriseId);
    teamByDept.set(departmentId, id);
    return id;
  }

  const passwordHash = await hashPassword(REGISTRATION_INITIAL_PASSWORD);
  const created: Array<{ id: number; name: string; phone: string; depts: string[] }> = [];
  const alreadyLocal: string[] = [];

  for (const user of byUserid.values()) {
    const phone = normalizeDingtalkMobile(user.mobile);
    if (!phone) continue;
    if (byPhone.has(phone) || byDingUserid.has(user.userid)) {
      alreadyLocal.push(user.userid);
      continue;
    }
    const profile = (await fetchDingtalkUser({ token, userid: user.userid })) ?? user;
    const deptIds = profile.deptIds.length ? profile.deptIds : user.deptIds;
    const mapped = deptIds
      .map((dingId) => deptByDing.get(dingId))
      .filter((row): row is { id: number; enterpriseId: number } => row != null);
    if (mapped.length === 0) {
      throw new Error(`钉钉 ${profile.name} ${phone} 没有已映射部门: ${deptIds.join(",")}`);
    }
    const [employee] = await db
      .insert(employees)
      .values({
        name: profile.name.slice(0, 100),
        phone,
        passwordHash,
        role: "employee",
        status: "active",
        enterpriseId: group.id,
        mustChangePassword: false,
        isDingtalk: true,
        createdBy: 1,
        ...dingtalkOrgEmployeePatch(profile),
      })
      .returning({ id: employees.id });
    const attached: string[] = [];
    for (const dept of mapped) {
      const teamId = await teamIdFor(dept.id, dept.enterpriseId);
      const [member] = await db
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.employeeId, employee.id)))
        .limit(1);
      if (!member) {
        await db.insert(teamMembers).values({ teamId, employeeId: employee.id });
      }
      attached.push(String(dept.id));
    }
    created.push({ id: employee.id, name: profile.name, phone, depts: attached });
    await writeOpsAudit({
      actorEmployeeId: 1,
      action: "user.create",
      targetType: "employee",
      targetId: String(employee.id),
      detail: { name: profile.name, phone, reason: "补齐钉钉通讯录" },
    });
    byPhone.set(phone, { id: employee.id, phone, dingtalkUserid: profile.userid });
    byDingUserid.set(profile.userid, { id: employee.id, phone, dingtalkUserid: profile.userid });
  }

  console.log(
    JSON.stringify(
      {
        dingUnique: byUserid.size,
        alreadyLocal: alreadyLocal.length,
        created: created.length,
        people: created,
        outsourceDepartmentId: outsourceId,
      },
      null,
      2,
    ),
  );
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
