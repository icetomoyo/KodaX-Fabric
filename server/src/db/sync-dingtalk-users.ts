import { eq, inArray, isNotNull } from "drizzle-orm";
import "../config.js";
import { env } from "../config.js";
import { db } from "./client.js";
import { departments, employees, teamMembers } from "./schema/index.js";
import { ensureDefaultTeam } from "../lib/enterprise.js";
import {
  dingtalkOrgEmployeePatch,
  enrichDingtalkUsersWithGet,
  fetchDingtalkAccessToken,
  fetchDingtalkDeptUsers,
  mergeDingtalkUserDetails,
  readDingtalkCredentials,
  type DingtalkUserDetail,
} from "../lib/dingtalk-department-tree.js";
import {
  normalizeDingtalkMobile,
  planDingtalkUserImport,
  type DingtalkImportCandidate,
} from "../lib/dingtalk-user-import.js";
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
  const listed: DingtalkImportCandidate[] = [];
  const byUserid = new Map<string, DingtalkUserDetail>();
  for (const department of mapped) {
    if (department.dingtalkDeptId == null) continue;
    const users = await fetchDingtalkDeptUsers({ token, deptId: department.dingtalkDeptId });
    for (const user of users) {
      const existing = byUserid.get(user.userid);
      byUserid.set(user.userid, existing ? mergeDingtalkUserDetails(existing, user) : user);
      listed.push({
        profile: user,
        departmentId: department.id,
        enterpriseId: department.enterpriseId,
        departmentName: department.name,
      });
    }
  }
  const enriched = await enrichDingtalkUsersWithGet({ token, users: [...byUserid.values()] });
  const profileByUserid = new Map(enriched.map((row) => [row.userid, row]));
  const candidates: DingtalkImportCandidate[] = listed.map((row) => ({
    ...row,
    profile: profileByUserid.get(row.profile.userid) ?? row.profile,
  }));

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
          isDingtalk: true,
          ...dingtalkOrgEmployeePatch(create.profile),
        })
        .returning({ id: employees.id });
      const teamId = await ensureDefaultTeam(create.departmentId, create.enterpriseId);
      await db.insert(teamMembers).values({
        teamId,
        employeeId: employee.id,
      });
    }
    const existingByPhone = new Map<string, DingtalkUserDetail>();
    for (const row of plan.skippedExisting) {
      const phone = normalizeDingtalkMobile(row.profile.mobile);
      if (!phone) continue;
      existingByPhone.set(phone, row.profile);
    }
    const existingPhonesInDing = [...existingByPhone.keys()];
    if (existingPhonesInDing.length) {
      await db
        .update(employees)
        .set({ isDingtalk: true })
        .where(inArray(employees.phone, existingPhonesInDing));
      for (const [phone, profile] of existingByPhone) {
        await db
          .update(employees)
          .set({
            ...dingtalkOrgEmployeePatch(profile),
            updatedAt: new Date(),
          })
          .where(eq(employees.phone, phone));
      }
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
          name: row.profile.name,
          userid: row.profile.userid,
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
