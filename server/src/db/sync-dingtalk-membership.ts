import { readFileSync, writeFileSync } from "node:fs";
import { chmodSync } from "node:fs";
import "../config.js";
import { db } from "./client.js";
import { departments, employees, teamMembers, teams } from "./schema/index.js";
import { eq } from "drizzle-orm";
import { hashPassword, REGISTRATION_INITIAL_PASSWORD } from "../lib/password.js";
import {
  dingtalkMembershipSyncSql,
  planDingtalkMembershipSync,
  type DingtalkRosterUser,
} from "../lib/dingtalk-membership-sync.js";

async function main() {
  const argv = process.argv.slice(2);
  const fromJsonIdx = argv.indexOf("--from-json");
  const sqlOutIdx = argv.indexOf("--sql-out");
  const source =
    argv.find((item, index) => argv[index - 1] === "--source") ??
    `dingtalk-membership-sync-${new Date().toISOString().slice(0, 10)}`;
  if (fromJsonIdx < 0 || !argv[fromJsonIdx + 1]) throw new Error("--from-json 需要钉钉人员文件");
  const sqlOut = sqlOutIdx >= 0 ? argv[sqlOutIdx + 1] : undefined;
  const payload = JSON.parse(readFileSync(argv[fromJsonIdx + 1]!, "utf8")) as { users: DingtalkRosterUser[] };
  const [employeeRows, departmentRows, membershipRows] = await Promise.all([
    db
      .select({
        id: employees.id,
        name: employees.name,
        phone: employees.phone,
        role: employees.role,
        isDingtalk: employees.isDingtalk,
        dingtalkUserid: employees.dingtalkUserid,
      })
      .from(employees),
    db
      .select({
        id: departments.id,
        parentId: departments.parentId,
        dingtalkDeptId: departments.dingtalkDeptId,
      })
      .from(departments),
    db
      .select({
        phone: employees.phone,
        dingtalkDeptId: departments.dingtalkDeptId,
      })
      .from(teamMembers)
      .innerJoin(employees, eq(teamMembers.employeeId, employees.id))
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .innerJoin(departments, eq(teams.departmentId, departments.id)),
  ]);
  const plan = planDingtalkMembershipSync({
    roster: payload.users,
    employees: employeeRows,
    memberships: membershipRows,
    departments: departmentRows,
  });
  const passwordHash = await hashPassword(REGISTRATION_INITIAL_PASSWORD);
  const sql = dingtalkMembershipSyncSql(plan, { source, passwordHash });
  if (sqlOut) {
    writeFileSync(sqlOut, `${sql}\n`);
    chmodSync(sqlOut, 0o600);
  }
  console.log(
    JSON.stringify(
      {
        source,
        roster: payload.users.length,
        phoneUpdates: plan.phoneUpdates,
        imports: plan.imports.map((row) => `${row.name} ${row.phone}`),
        leavers: plan.leavers.map((row) => `${row.name} ${row.phone}`),
        presence: plan.presence.length,
        adds: plan.adds.length,
        removes: plan.removes.length,
        retargets: plan.retargets.length,
        skippedNoMapped: plan.skippedNoMapped.length,
        sqlOut: sqlOut ?? null,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
