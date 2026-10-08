import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import "../config.js";
import { db } from "./client.js";
import { departments, employeeApiKeys, employees, enterprises, teamMembers, teams } from "./schema/index.js";
import { DEFAULT_TEAM_NAME, ensureDefaultTeam } from "../lib/enterprise.js";
import { refreshEmployeeDingtalkPresence } from "../lib/employee-dingtalk-presence.js";
import { pickApiKeyRetargetDepartment } from "../lib/org-chart-sync.js";
import { writeOpsAudit } from "../lib/ops-audit.js";

const GROUP_NAME = "海致集团";
const KEJI_NAME = "海致科技";
const XINGTU_NAME = "海致星图";
const KEJI_DING = 855501967;
const XINGTU_DING = 139656157;
const SKIP_MEMBERSHIP_DING_IDS = new Set([
  1,
  990493186, // 残疾人安置（科技）
  990692143, // 残疾人安置（星图）
]);
const MISSING_DEPARTMENTS: Array<{
  name: string;
  dingtalkDeptId: number;
  parentDingtalkDeptId: number;
}> = [
  { name: "外包团队", dingtalkDeptId: 1093320169, parentDingtalkDeptId: KEJI_DING },
  { name: "产业智能创新支持中心", dingtalkDeptId: 1122853262, parentDingtalkDeptId: KEJI_DING },
  { name: "解决方案与交付中心", dingtalkDeptId: 1123136196, parentDingtalkDeptId: KEJI_DING },
  { name: "运营商三部销售", dingtalkDeptId: 1122761871, parentDingtalkDeptId: 1084126308 },
  { name: "运营商三部咨询", dingtalkDeptId: 1122988819, parentDingtalkDeptId: 1084126308 },
  { name: "运营商三部项目交付", dingtalkDeptId: 1123132730, parentDingtalkDeptId: 1084126308 },
  { name: "运营商三部研发", dingtalkDeptId: 1123258326, parentDingtalkDeptId: 1123132730 },
  { name: "运营商三部交付实施", dingtalkDeptId: 1123321259, parentDingtalkDeptId: 1123132730 },
];

function asDeptIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
}

async function foldEnterprisesIntoDepartments() {
  const group = await db
    .select()
    .from(enterprises)
    .where(eq(enterprises.name, GROUP_NAME))
    .then((rows) => rows[0]);
  const keji = await db
    .select()
    .from(enterprises)
    .where(eq(enterprises.name, KEJI_NAME))
    .then((rows) => rows[0]);
  const xingtu = await db
    .select()
    .from(enterprises)
    .where(eq(enterprises.name, XINGTU_NAME))
    .then((rows) => rows[0]);
  if (!group) throw new Error("缺少企业 海致集团");
  if (!keji && !xingtu) {
    return { groupId: group.id, kejiDepartmentId: null, xingtuDepartmentId: null, folded: false };
  }

  return db.transaction(async (tx) => {
    if (keji) {
      await tx.update(enterprises).set({ dingtalkDeptId: null, updatedAt: new Date() }).where(eq(enterprises.id, keji.id));
    }
    if (xingtu) {
      await tx
        .update(enterprises)
        .set({ dingtalkDeptId: null, updatedAt: new Date() })
        .where(eq(enterprises.id, xingtu.id));
    }

    const insertUnit = async (name: string, dingtalkDeptId: number) => {
      const [existing] = await tx
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.dingtalkDeptId, dingtalkDeptId))
        .limit(1);
      if (existing) return existing.id;
      const [row] = await tx
        .insert(departments)
        .values({
          enterpriseId: group.id,
          parentId: null,
          name,
          dingtalkDeptId,
          status: "active",
          isDefault: false,
        })
        .returning({ id: departments.id });
      await tx.insert(teams).values({
        enterpriseId: group.id,
        departmentId: row.id,
        name: DEFAULT_TEAM_NAME,
        status: "active",
        isDefault: true,
      });
      return row.id;
    };

    const kejiDepartmentId = keji ? await insertUnit(KEJI_NAME, KEJI_DING) : null;
    const xingtuDepartmentId = xingtu ? await insertUnit(XINGTU_NAME, XINGTU_DING) : null;

    const reparent = async (fromEnterpriseId: number, parentDepartmentId: number) => {
      await tx
        .update(departments)
        .set({ parentId: parentDepartmentId, enterpriseId: group.id, updatedAt: new Date() })
        .where(
          and(
            eq(departments.enterpriseId, fromEnterpriseId),
            isNull(departments.parentId),
            eq(departments.isDefault, false),
          ),
        );
      await tx
        .update(departments)
        .set({ enterpriseId: group.id, updatedAt: new Date() })
        .where(and(eq(departments.enterpriseId, fromEnterpriseId), eq(departments.isDefault, false)));
      await tx
        .update(teams)
        .set({ enterpriseId: group.id, updatedAt: new Date() })
        .where(eq(teams.enterpriseId, fromEnterpriseId));
    };

    if (keji && kejiDepartmentId != null) await reparent(keji.id, kejiDepartmentId);
    if (xingtu && xingtuDepartmentId != null) await reparent(xingtu.id, xingtuDepartmentId);

    const leftoverEnterprises = [keji?.id, xingtu?.id].filter((id): id is number => id != null);
    if (leftoverEnterprises.length) {
      const leftoverDefaults = await tx
        .select({ id: departments.id })
        .from(departments)
        .where(and(inArray(departments.enterpriseId, leftoverEnterprises), eq(departments.isDefault, true)));
      const leftoverDeptIds = leftoverDefaults.map((row) => row.id);
      if (leftoverDeptIds.length) {
        const leftoverTeams = await tx
          .select({ id: teams.id })
          .from(teams)
          .where(inArray(teams.departmentId, leftoverDeptIds));
        const leftoverTeamIds = leftoverTeams.map((row) => row.id);
        if (leftoverTeamIds.length) {
          await tx.delete(teamMembers).where(inArray(teamMembers.teamId, leftoverTeamIds));
          await tx.delete(teams).where(inArray(teams.id, leftoverTeamIds));
        }
        await tx.delete(departments).where(inArray(departments.id, leftoverDeptIds));
      }
      await tx
        .update(employees)
        .set({ enterpriseId: group.id, updatedAt: new Date() })
        .where(inArray(employees.enterpriseId, leftoverEnterprises));
      await tx
        .update(employees)
        .set({ role: "dept_admin", updatedAt: new Date() })
        .where(and(eq(employees.role, "org_admin"), eq(employees.enterpriseId, group.id)));
      await tx.delete(enterprises).where(inArray(enterprises.id, leftoverEnterprises));
    }

    return {
      groupId: group.id,
      kejiDepartmentId,
      xingtuDepartmentId,
      folded: true,
    };
  });
}

async function ensureMissingDepartments(groupId: number) {
  const created: string[] = [];
  for (const item of MISSING_DEPARTMENTS) {
    const [existing] = await db
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.dingtalkDeptId, item.dingtalkDeptId))
      .limit(1);
    if (existing) continue;
    const [parent] = await db
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.dingtalkDeptId, item.parentDingtalkDeptId))
      .limit(1);
    if (!parent) throw new Error(`缺少父部门 ding ${item.parentDingtalkDeptId}（${item.name}）`);
    const [row] = await db
      .insert(departments)
      .values({
        enterpriseId: groupId,
        parentId: parent.id,
        name: item.name,
        dingtalkDeptId: item.dingtalkDeptId,
        status: "active",
        isDefault: false,
      })
      .returning({ id: departments.id });
    await ensureDefaultTeam(row.id, groupId);
    created.push(item.name);
  }
  return created;
}

async function alignMemberships() {
  const deptRows = await db
    .select({
      id: departments.id,
      parentId: departments.parentId,
      dingtalkDeptId: departments.dingtalkDeptId,
    })
    .from(departments);
  const byDing = new Map<number, number>();
  for (const row of deptRows) {
    if (row.dingtalkDeptId != null) byDing.set(row.dingtalkDeptId, row.id);
  }
  const defaultTeams = await db
    .select({ id: teams.id, departmentId: teams.departmentId })
    .from(teams)
    .where(eq(teams.isDefault, true));
  const defaultTeamByDepartment = new Map(defaultTeams.map((row) => [row.departmentId, row.id]));
  const tree = deptRows.map((row) => ({ id: row.id, parentId: row.parentId }));

  const people = await db
    .select({
      id: employees.id,
      name: employees.name,
      role: employees.role,
      dingtalkDeptIds: employees.dingtalkDeptIds,
    })
    .from(employees);

  let changed = 0;
  let skippedNoMapped = 0;
  let retargetedKeys = 0;
  const samples: Array<{ id: number; name: string; added: number; removed: number }> = [];

  for (const person of people) {
    if (person.role === "admin") continue;
    const wanted = [
      ...new Set(
        asDeptIds(person.dingtalkDeptIds)
          .filter((dingId) => !SKIP_MEMBERSHIP_DING_IDS.has(dingId))
          .map((dingId) => byDing.get(dingId))
          .filter((id): id is number => id != null),
      ),
    ];
    if (wanted.length === 0) {
      skippedNoMapped += 1;
      continue;
    }

    const current = await db
      .select({
        teamId: teamMembers.teamId,
        departmentId: teams.departmentId,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(eq(teamMembers.employeeId, person.id));
    const currentDeptIds = new Set(current.map((row) => row.departmentId));
    const desiredSet = new Set(wanted);
    const toAdd = wanted.filter((id) => !currentDeptIds.has(id));
    const toRemove = current.filter((row) => !desiredSet.has(row.departmentId));
    if (toAdd.length === 0 && toRemove.length === 0) continue;

    if (toRemove.length > 0) {
      const keys = await db
        .select({
          id: employeeApiKeys.id,
          teamId: employeeApiKeys.teamId,
          departmentId: teams.departmentId,
        })
        .from(employeeApiKeys)
        .innerJoin(teams, eq(employeeApiKeys.teamId, teams.id))
        .where(
          and(
            eq(employeeApiKeys.employeeId, person.id),
            inArray(
              employeeApiKeys.teamId,
              toRemove.map((row) => row.teamId),
            ),
          ),
        );
      for (const key of keys) {
        const nextDepartmentId = pickApiKeyRetargetDepartment({
          removedDepartmentId: key.departmentId,
          desiredDepartmentIds: wanted,
          departments: tree,
        });
        const nextTeamId = nextDepartmentId != null ? defaultTeamByDepartment.get(nextDepartmentId) : null;
        if (nextTeamId != null && nextTeamId !== key.teamId) {
          await db.update(employeeApiKeys).set({ teamId: nextTeamId }).where(eq(employeeApiKeys.id, key.id));
          retargetedKeys += 1;
        }
      }
      await db.delete(teamMembers).where(
        and(
          eq(teamMembers.employeeId, person.id),
          inArray(
            teamMembers.teamId,
            toRemove.map((row) => row.teamId),
          ),
        ),
      );
    }

    for (const departmentId of toAdd) {
      const teamId = defaultTeamByDepartment.get(departmentId);
      if (teamId == null) continue;
      await db
        .insert(teamMembers)
        .values({ teamId, employeeId: person.id })
        .onConflictDoNothing({ target: [teamMembers.teamId, teamMembers.employeeId] });
    }

    changed += 1;
    if (samples.length < 20) {
      samples.push({ id: person.id, name: person.name, added: toAdd.length, removed: toRemove.length });
    }
  }

  return { changed, skippedNoMapped, retargetedKeys, samples };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, message: "fold + presence + membership 需要写库，去掉 --dry-run 执行" }));
    return;
  }

  const fold = await foldEnterprisesIntoDepartments();
  await db
    .update(employees)
    .set({ enterpriseId: fold.groupId, updatedAt: new Date() })
    .where(and(isNull(employees.enterpriseId), isNotNull(employees.dingtalkUserid)));
  const createdDepartments = await ensureMissingDepartments(fold.groupId);
  let presence: unknown = null;
  try {
    presence = await refreshEmployeeDingtalkPresence();
  } catch (error) {
    presence = { error: error instanceof Error ? error.message : String(error) };
  }
  const membership = await alignMemberships();

  await writeOpsAudit({
    actorEmployeeId: 1,
    action: "org.dingtalk_align",
    targetType: "enterprise",
    targetId: String(fold.groupId),
    detail: {
      fold,
      createdDepartments,
      presence,
      membership: {
        changed: membership.changed,
        skippedNoMapped: membership.skippedNoMapped,
        retargetedKeys: membership.retargetedKeys,
      },
    },
  });

  console.log(
    JSON.stringify(
      {
        fold,
        createdDepartments,
        presence,
        membership,
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
