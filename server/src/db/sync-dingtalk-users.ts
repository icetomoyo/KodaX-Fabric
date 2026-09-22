import { isNotNull } from "drizzle-orm";
import "../config.js";
import { env } from "../config.js";
import { db } from "./client.js";
import { departments, employees, teamMembers } from "./schema/index.js";
import { ensureDefaultTeam } from "../lib/enterprise.js";
import {
  fetchDingtalkAccessToken,
  fetchDingtalkDeptUsers,
  readDingtalkCredentials,
} from "../lib/dingtalk-department-tree.js";
import { planDingtalkUserImport, type DingtalkImportCandidate } from "../lib/dingtalk-user-import.js";
import { hashPassword, REGISTRATION_INITIAL_PASSWORD } from "../lib/password.js";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const credentials = readDingtalkCredentials(env);
  if (!credentials) throw new Error("未配置钉钉 AppKey / AppSecret");

  const mapped = await db
    .select({
      id: departments.id,
      name: departments.name,
      enterpriseId: departments.enterpriseId,
      dingtalkDeptId: departments.dingtalkDeptId,
    })
    .from(departments)
    .where(isNotNull(departments.dingtalkDeptId));
  const existing = await db.select({ phone: employees.phone }).from(employees);
  const existingPhones = new Set(existing.map((row) => row.phone));

  const token = await fetchDingtalkAccessToken(credentials);
  const candidates: DingtalkImportCandidate[] = [];
  for (const department of mapped) {
    if (department.dingtalkDeptId == null) continue;
    const users = await fetchDingtalkDeptUsers({ token, deptId: department.dingtalkDeptId });
    for (const user of users) {
      candidates.push({
        userid: user.userid,
        name: user.name,
        mobile: user.mobile,
        departmentId: department.id,
        enterpriseId: department.enterpriseId,
        departmentName: department.name,
      });
    }
  }

  const plan = planDingtalkUserImport({ candidates, existingPhones });
  if (!dryRun) {
    const passwordHash = await hashPassword(REGISTRATION_INITIAL_PASSWORD);
    for (const create of plan.creates) {
      const [employee] = await db
        .insert(employees)
        .values({
          name: create.name,
          phone: create.phone,
          passwordHash,
          role: "employee",
          status: "active",
          enterpriseId: create.enterpriseId,
          mustChangePassword: false,
        })
        .returning({ id: employees.id });
      const teamId = await ensureDefaultTeam(create.departmentId, create.enterpriseId);
      await db.insert(teamMembers).values({
        teamId,
        employeeId: employee.id,
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        departments: mapped.length,
        dingTalkUsers: candidates.length,
        creates: plan.creates.length,
        skippedExisting: plan.skippedExisting.length,
        skippedNoPhone: plan.skippedNoPhone.length,
        skippedBadPhone: plan.skippedBadPhone.length,
        createdSample: plan.creates.slice(0, 20).map((row) => ({
          name: row.name,
          phone: row.phone,
          department: row.departmentName,
        })),
        noPhoneSample: plan.skippedNoPhone.slice(0, 20).map((row) => ({
          name: row.name,
          userid: row.userid,
          department: row.departmentName,
        })),
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
