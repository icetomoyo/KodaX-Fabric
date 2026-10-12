import { pickApiKeyRetargetDepartment } from "./org-chart-sync.js";
import { DINGTALK_GROUP_ENTERPRISE_NAME, SKIP_MEMBERSHIP_DING_IDS, sqlLiteral } from "./dingtalk-dept-id-map.js";

export type DingtalkRosterUser = {
  userid: string;
  name: string;
  phone: string | null;
  email: string | null;
  deptIds: number[];
  title: string | null;
  hiredAt: string | null;
  jobNumber: string | null;
  workPlace: string | null;
  remark: string | null;
  managerUserid: string | null;
  deptOrderList: unknown;
  leaderInDept: unknown;
  roleList: unknown;
};

export type EmployeeRow = {
  id: number;
  name: string;
  phone: string;
  role: string;
  isDingtalk: boolean;
  dingtalkUserid: string | null;
};

export type MembershipRow = {
  phone: string;
  dingtalkDeptId: number | null;
};

export type DepartmentRow = {
  id: number;
  parentId: number | null;
  dingtalkDeptId: number | null;
};

export type MembershipSyncPlan = {
  phoneUpdates: Array<{ userid: string; from: string; to: string; name: string }>;
  imports: DingtalkRosterUser[];
  presence: DingtalkRosterUser[];
  leavers: EmployeeRow[];
  adds: Array<{ phone: string; dingtalkDeptId: number }>;
  removes: Array<{ phone: string; dingtalkDeptId: number | null }>;
  retargets: Array<{ phone: string; fromDing: number; toDing: number }>;
  skippedNoMapped: Array<{ phone: string; name: string; deptIds: number[] }>;
};

function jsonSql(value: unknown): string {
  return `${sqlLiteral(JSON.stringify(value ?? null))}::jsonb`;
}

function textSql(value: string | null | undefined): string {
  return value == null || value === "" ? "NULL" : sqlLiteral(value);
}

export function planDingtalkMembershipSync(input: {
  roster: readonly DingtalkRosterUser[];
  employees: readonly EmployeeRow[];
  memberships: readonly MembershipRow[];
  departments: readonly DepartmentRow[];
}): MembershipSyncPlan {
  const mapped = new Set(
    input.departments.filter((row) => row.dingtalkDeptId != null).map((row) => row.dingtalkDeptId as number),
  );
  const byPhone = new Map(input.employees.map((row) => [row.phone, row]));
  const byUserid = new Map(
    input.employees.filter((row) => row.dingtalkUserid).map((row) => [row.dingtalkUserid as string, row]),
  );
  const membershipByPhone = new Map<string, MembershipRow[]>();
  for (const row of input.memberships) {
    const list = membershipByPhone.get(row.phone) ?? [];
    list.push(row);
    membershipByPhone.set(row.phone, list);
  }
  const localIdByDing = new Map<number, number>();
  for (const row of input.departments) {
    if (row.dingtalkDeptId != null) localIdByDing.set(row.dingtalkDeptId, row.id);
  }
  const tree = input.departments.map((row) => ({ id: row.id, parentId: row.parentId }));

  const phoneUpdates: MembershipSyncPlan["phoneUpdates"] = [];
  const imports: DingtalkRosterUser[] = [];
  const presence: DingtalkRosterUser[] = [];
  const skippedNoMapped: MembershipSyncPlan["skippedNoMapped"] = [];
  const adds: MembershipSyncPlan["adds"] = [];
  const removes: MembershipSyncPlan["removes"] = [];
  const retargets: MembershipSyncPlan["retargets"] = [];
  const rosterPhones = new Set<string>();

  for (const user of input.roster) {
    if (!user.phone) continue;
    const existing = byPhone.get(user.phone) ?? byUserid.get(user.userid);
    if (existing && existing.phone !== user.phone) {
      phoneUpdates.push({ userid: user.userid, from: existing.phone, to: user.phone, name: existing.name });
    }
    if (!existing) imports.push(user);
    presence.push(user);
    rosterPhones.add(user.phone);

    const desired = [
      ...new Set(user.deptIds.filter((dingId) => !SKIP_MEMBERSHIP_DING_IDS.has(dingId) && mapped.has(dingId))),
    ];
    if (desired.length === 0) {
      skippedNoMapped.push({ phone: user.phone, name: user.name, deptIds: user.deptIds });
      continue;
    }
    const currentPhone = existing?.phone ?? user.phone;
    const current = membershipByPhone.get(currentPhone) ?? [];
    const currentDings = new Set(current.map((row) => row.dingtalkDeptId).filter((id): id is number => id != null));
    const seenRemove = new Set<string>();
    for (const dingId of desired) {
      if (!currentDings.has(dingId)) adds.push({ phone: user.phone, dingtalkDeptId: dingId });
    }
    for (const row of current) {
      if (row.dingtalkDeptId != null && desired.includes(row.dingtalkDeptId)) continue;
      const key = `${user.phone}:${row.dingtalkDeptId ?? "null"}`;
      if (seenRemove.has(key)) continue;
      seenRemove.add(key);
      removes.push({ phone: user.phone, dingtalkDeptId: row.dingtalkDeptId });
    }
    const desiredLocal = desired.map((dingId) => localIdByDing.get(dingId)).filter((id): id is number => id != null);
    const seenFrom = new Set<number>();
    for (const row of current) {
      if (row.dingtalkDeptId == null || desired.includes(row.dingtalkDeptId) || seenFrom.has(row.dingtalkDeptId)) {
        continue;
      }
      seenFrom.add(row.dingtalkDeptId);
      const removedLocal = localIdByDing.get(row.dingtalkDeptId);
      if (removedLocal == null) continue;
      const nextLocal = pickApiKeyRetargetDepartment({
        removedDepartmentId: removedLocal,
        desiredDepartmentIds: desiredLocal,
        departments: tree,
      });
      const toDing =
        nextLocal == null
          ? null
          : ([...localIdByDing.entries()].find(([, id]) => id === nextLocal)?.[0] ?? null);
      if (toDing != null) {
        retargets.push({ phone: user.phone, fromDing: row.dingtalkDeptId, toDing });
      }
    }
  }

  const leavers = input.employees.filter(
    (row) => row.role !== "admin" && row.isDingtalk && !rosterPhones.has(row.phone) && !phoneUpdates.some((item) => item.from === row.phone),
  );

  return { phoneUpdates, imports, presence, leavers, adds, removes, retargets, skippedNoMapped };
}

export function dingtalkMembershipSyncSql(
  plan: MembershipSyncPlan,
  input: { source: string; passwordHash: string },
): string {
  const statements: string[] = ["BEGIN;"];
  for (const item of plan.phoneUpdates) {
    statements.push(
      `UPDATE employees SET phone = ${sqlLiteral(item.to)}, updated_at = now()
WHERE dingtalk_userid = ${sqlLiteral(item.userid)} AND phone = ${sqlLiteral(item.from)};`,
    );
  }
  if (plan.presence.length) {
    const rows = plan.presence.map((user) => {
      return `(${sqlLiteral(user.phone!)}, true, ${sqlLiteral(user.userid)}, ${textSql(user.email)}, ${textSql(user.title)}, ${textSql(user.hiredAt)}::date, ${textSql(user.jobNumber)}, ${textSql(user.workPlace)}, ${textSql(user.remark)}, ${textSql(user.managerUserid)}, ${jsonSql(user.deptIds)}, ${jsonSql(user.deptOrderList)}, ${jsonSql(user.leaderInDept)}, ${jsonSql(user.roleList)})`;
    });
    statements.push(`CREATE TEMP TABLE ding_presence (
  phone text PRIMARY KEY,
  is_dingtalk boolean,
  dingtalk_userid text,
  email text,
  job_title text,
  hired_at date,
  job_number text,
  work_place text,
  dingtalk_remark text,
  manager_userid text,
  dingtalk_dept_ids jsonb,
  dept_order_list jsonb,
  leader_in_dept jsonb,
  role_list jsonb
);`);
    const chunk = 80;
    for (let i = 0; i < rows.length; i += chunk) {
      statements.push(
        `INSERT INTO ding_presence (phone, is_dingtalk, dingtalk_userid, email, job_title, hired_at, job_number, work_place, dingtalk_remark, manager_userid, dingtalk_dept_ids, dept_order_list, leader_in_dept, role_list)
VALUES
${rows.slice(i, i + chunk).join(",\n")};`,
      );
    }
    statements.push(`UPDATE employees e SET
  is_dingtalk = p.is_dingtalk,
  dingtalk_userid = p.dingtalk_userid,
  email = p.email,
  job_title = p.job_title,
  hired_at = p.hired_at,
  job_number = p.job_number,
  work_place = p.work_place,
  dingtalk_remark = p.dingtalk_remark,
  manager_userid = p.manager_userid,
  dingtalk_dept_ids = p.dingtalk_dept_ids,
  dept_order_list = p.dept_order_list,
  leader_in_dept = p.leader_in_dept,
  role_list = p.role_list,
  updated_at = now()
FROM ding_presence p
WHERE e.phone = p.phone;`);
  }
  if (plan.leavers.length) {
    statements.push(
      `UPDATE employees SET is_dingtalk = false, updated_at = now()
WHERE phone IN (${plan.leavers.map((row) => sqlLiteral(row.phone)).join(", ")});`,
    );
  }
  for (const user of plan.imports) {
    statements.push(
      `INSERT INTO employees (
  name, phone, password_hash, role, status, enterprise_id, must_change_password, is_dingtalk, created_by,
  dingtalk_userid, email, job_title, hired_at, job_number, work_place, dingtalk_remark, manager_userid,
  dingtalk_dept_ids, dept_order_list, leader_in_dept, role_list
)
SELECT
  ${sqlLiteral(user.name.slice(0, 100))}, ${sqlLiteral(user.phone!)}, ${sqlLiteral(input.passwordHash)},
  'employee', 'active', e.id, false, true, 1,
  ${sqlLiteral(user.userid)}, ${textSql(user.email)}, ${textSql(user.title)}, ${textSql(user.hiredAt)}::date,
  ${textSql(user.jobNumber)}, ${textSql(user.workPlace)}, ${textSql(user.remark)}, ${textSql(user.managerUserid)},
  ${jsonSql(user.deptIds)}, ${jsonSql(user.deptOrderList)}, ${jsonSql(user.leaderInDept)}, ${jsonSql(user.roleList)}
FROM enterprises e
WHERE e.name = ${sqlLiteral(DINGTALK_GROUP_ENTERPRISE_NAME)}
  AND NOT EXISTS (SELECT 1 FROM employees x WHERE x.phone = ${sqlLiteral(user.phone!)});`,
    );
  }
  if (plan.retargets.length) {
    statements.push(`CREATE TEMP TABLE ding_key_retarget (phone text, from_ding bigint, to_ding bigint);`);
    const rows = plan.retargets.map(
      (row) => `(${sqlLiteral(row.phone)}, ${row.fromDing}, ${row.toDing})`,
    );
    const chunk = 200;
    for (let i = 0; i < rows.length; i += chunk) {
      statements.push(
        `INSERT INTO ding_key_retarget (phone, from_ding, to_ding) VALUES\n${rows.slice(i, i + chunk).join(",\n")};`,
      );
    }
    statements.push(`UPDATE employee_api_keys k
SET team_id = nt.id
FROM employees e, ding_key_retarget r, teams ot, departments od, departments nd, teams nt
WHERE k.employee_id = e.id
  AND r.phone = e.phone
  AND ot.id = k.team_id
  AND od.id = ot.department_id
  AND od.dingtalk_dept_id = r.from_ding
  AND nd.dingtalk_dept_id = r.to_ding
  AND nt.department_id = nd.id
  AND nt.is_default
  AND k.team_id IS DISTINCT FROM nt.id;`);
  }
  if (plan.removes.length) {
    statements.push(`CREATE TEMP TABLE ding_remove (phone text, ding bigint);`);
    const rows = plan.removes.map(
      (row) => `(${sqlLiteral(row.phone)}, ${row.dingtalkDeptId == null ? "NULL" : String(row.dingtalkDeptId)})`,
    );
    const chunk = 200;
    for (let i = 0; i < rows.length; i += chunk) {
      statements.push(`INSERT INTO ding_remove (phone, ding) VALUES\n${rows.slice(i, i + chunk).join(",\n")};`);
    }
    statements.push(`DELETE FROM team_members tm
USING employees e, teams t, departments d, ding_remove r
WHERE tm.employee_id = e.id
  AND tm.team_id = t.id
  AND t.department_id = d.id
  AND e.phone = r.phone
  AND e.role <> 'admin'
  AND d.dingtalk_dept_id IS NOT DISTINCT FROM r.ding;`);
  }
  if (plan.adds.length) {
    statements.push(`CREATE TEMP TABLE ding_add (phone text, ding bigint);`);
    const rows = plan.adds.map((row) => `(${sqlLiteral(row.phone)}, ${row.dingtalkDeptId})`);
    const chunk = 200;
    for (let i = 0; i < rows.length; i += chunk) {
      statements.push(`INSERT INTO ding_add (phone, ding) VALUES\n${rows.slice(i, i + chunk).join(",\n")};`);
    }
    statements.push(`INSERT INTO team_members (team_id, employee_id)
SELECT t.id, e.id
FROM ding_add a
JOIN employees e ON e.phone = a.phone
JOIN departments d ON d.dingtalk_dept_id = a.ding
JOIN teams t ON t.department_id = d.id AND t.is_default
ON CONFLICT (team_id, employee_id) DO NOTHING;`);
  }
  const detail = JSON.stringify({
    source: input.source,
    phoneUpdates: plan.phoneUpdates,
    imports: plan.imports.map((row) => ({ name: row.name, phone: row.phone, deptIds: row.deptIds })),
    leavers: plan.leavers.map((row) => ({ id: row.id, name: row.name, phone: row.phone })),
    presence: plan.presence.length,
    adds: plan.adds.length,
    removes: plan.removes.length,
    retargets: plan.retargets.length,
    skippedNoMapped: plan.skippedNoMapped.length,
  });
  statements.push(
    `INSERT INTO ops_audit_logs (actor_employee_id, action, target_type, target_id, detail)
VALUES (1, 'org.dingtalk_align', 'enterprise', '1', ${sqlLiteral(detail)}::jsonb);`,
  );
  statements.push("COMMIT;");
  return statements.join("\n\n");
}
