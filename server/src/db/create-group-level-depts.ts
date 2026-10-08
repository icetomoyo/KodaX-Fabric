import { and, eq } from "drizzle-orm";
import "../config.js";
import { env } from "../config.js";
import { db } from "./client.js";
import { departments, employees, enterprises, teamMembers } from "./schema/index.js";
import { ensureDefaultTeam } from "../lib/enterprise.js";
import {
  dingtalkOrgEmployeePatch,
  fetchDingtalkAccessToken,
  fetchDingtalkDeptUsers,
  fetchDingtalkUser,
  readDingtalkCredentials,
} from "../lib/dingtalk-department-tree.js";
import { normalizeDingtalkMobile } from "../lib/dingtalk-user-import.js";
import { hashPassword, REGISTRATION_INITIAL_PASSWORD } from "../lib/password.js";
import { writeOpsAudit } from "../lib/ops-audit.js";

const GROUP_NAME = "海致集团";
const UNITS = [
  { name: "外部人员组", dingtalkDeptId: 466106826 },
  { name: "法务顾问", dingtalkDeptId: 852231882 },
  { name: "钉钉部署", dingtalkDeptId: 927735948 },
  { name: "分贝通测试", dingtalkDeptId: 1089469669 },
] as const;

async function main() {
  const [group] = await db.select().from(enterprises).where(eq(enterprises.name, GROUP_NAME)).limit(1);
  if (!group) throw new Error("缺少企业 海致集团");

  const createdDepts: Array<{ id: number; name: string; dingtalkDeptId: number; teamId: number }> = [];
  for (const unit of UNITS) {
    const [existing] = await db
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.dingtalkDeptId, unit.dingtalkDeptId))
      .limit(1);
    if (existing) {
      const teamId = await ensureDefaultTeam(existing.id, group.id);
      createdDepts.push({
        id: existing.id,
        name: unit.name,
        dingtalkDeptId: unit.dingtalkDeptId,
        teamId,
      });
      continue;
    }
    const [row] = await db
      .insert(departments)
      .values({
        enterpriseId: group.id,
        parentId: null,
        name: unit.name,
        dingtalkDeptId: unit.dingtalkDeptId,
        status: "active",
        isDefault: false,
      })
      .returning({ id: departments.id });
    const teamId = await ensureDefaultTeam(row.id, group.id);
    createdDepts.push({
      id: row.id,
      name: unit.name,
      dingtalkDeptId: unit.dingtalkDeptId,
      teamId,
    });
    await writeOpsAudit({
      actorEmployeeId: 1,
      action: "department.create",
      targetType: "department",
      targetId: String(row.id),
      detail: { name: unit.name, dingtalkDeptId: unit.dingtalkDeptId, reason: "钉钉集团根一级部门" },
    });
  }

  const credentials = readDingtalkCredentials(env);
  if (!credentials) throw new Error("未配置钉钉");
  const token = await fetchDingtalkAccessToken(credentials);
  const passwordHash = await hashPassword(REGISTRATION_INITIAL_PASSWORD);

  const createdPeople: Array<{ id: number; name: string; phone: string; department: string }> = [];
  const attached: Array<{ id: number; name: string; department: string }> = [];

  for (const dept of createdDepts) {
    const listed = await fetchDingtalkDeptUsers({ token, deptId: dept.dingtalkDeptId });
    for (const listedUser of listed) {
      const profile = (await fetchDingtalkUser({ token, userid: listedUser.userid })) ?? listedUser;
      const phone = normalizeDingtalkMobile(profile.mobile);
      if (!phone) continue;
      const [existing] = await db
        .select({ id: employees.id, name: employees.name })
        .from(employees)
        .where(eq(employees.phone, phone))
        .limit(1);
      if (existing) {
        await db
          .update(employees)
          .set({
            isDingtalk: true,
            enterpriseId: group.id,
            ...dingtalkOrgEmployeePatch(profile),
            updatedAt: new Date(),
          })
          .where(eq(employees.id, existing.id));
        const [member] = await db
          .select({ id: teamMembers.id })
          .from(teamMembers)
          .where(and(eq(teamMembers.teamId, dept.teamId), eq(teamMembers.employeeId, existing.id)))
          .limit(1);
        if (!member) {
          await db.insert(teamMembers).values({ teamId: dept.teamId, employeeId: existing.id });
        }
        attached.push({ id: existing.id, name: existing.name, department: dept.name });
        continue;
      }
      const [employee] = await db
        .insert(employees)
        .values({
          name: profile.name,
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
      await db.insert(teamMembers).values({ teamId: dept.teamId, employeeId: employee.id });
      createdPeople.push({
        id: employee.id,
        name: profile.name,
        phone,
        department: dept.name,
      });
      await writeOpsAudit({
        actorEmployeeId: 1,
        action: "user.create",
        targetType: "employee",
        targetId: String(employee.id),
        detail: { name: profile.name, phone, department: dept.name, reason: "钉钉集团根一级部门导入" },
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        departments: createdDepts.map((row) => ({ id: row.id, name: row.name, ding: row.dingtalkDeptId })),
        createdPeople,
        attached,
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
