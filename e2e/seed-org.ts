import { and, eq } from "drizzle-orm";
import { db, sql } from "../server/src/db/client.js";
import { departments, employees, enterprises, teamMembers } from "../server/src/db/schema/index.js";
import { ensureDefaultTeam, insertEnterprise } from "../server/src/lib/enterprise.js";
import { hashPassword, REGISTRATION_INITIAL_PASSWORD } from "../server/src/lib/password.js";
import { E2E_ORG } from "./org-fixture.ts";

/**
 * 在 db:seed 之后写入 E2E 子公司/部门。
 * 组织节点只能由同步（或本夹具）创建，admin POST 已关闭。
 */
async function ensureEnterprise(input: {
  name: string;
  parentId: number | null;
  dingtalkDeptId: number;
}) {
  const [existing] = await db
    .select({
      id: enterprises.id,
      parentId: enterprises.parentId,
      dingtalkDeptId: enterprises.dingtalkDeptId,
    })
    .from(enterprises)
    .where(eq(enterprises.name, input.name))
    .limit(1);
  if (!existing) {
    return insertEnterprise({
      name: input.name,
      status: "active",
      parentId: input.parentId,
      dingtalkDeptId: input.dingtalkDeptId,
    });
  }
  if (existing.parentId !== input.parentId || existing.dingtalkDeptId !== input.dingtalkDeptId) {
    const [row] = await db
      .update(enterprises)
      .set({ parentId: input.parentId, dingtalkDeptId: input.dingtalkDeptId })
      .where(eq(enterprises.id, existing.id))
      .returning({ id: enterprises.id });
    return row;
  }
  return existing;
}

async function ensureNamedDepartment(input: {
  name: string;
  enterpriseId: number;
  dingtalkDeptId: number;
}) {
  const [existing] = await db
    .select({
      id: departments.id,
      dingtalkDeptId: departments.dingtalkDeptId,
    })
    .from(departments)
    .where(and(eq(departments.enterpriseId, input.enterpriseId), eq(departments.name, input.name)))
    .limit(1);
  if (!existing) {
    const [row] = await db
      .insert(departments)
      .values({
        enterpriseId: input.enterpriseId,
        name: input.name,
        status: "active",
        isDefault: false,
        dingtalkDeptId: input.dingtalkDeptId,
      })
      .returning({ id: departments.id });
    await ensureDefaultTeam(row.id, input.enterpriseId);
    return row;
  }
  if (existing.dingtalkDeptId !== input.dingtalkDeptId) {
    await db
      .update(departments)
      .set({ dingtalkDeptId: input.dingtalkDeptId, updatedAt: new Date() })
      .where(eq(departments.id, existing.id));
  }
  await ensureDefaultTeam(existing.id, input.enterpriseId);
  return existing;
}

async function ensureEmployee(input: {
  name: string;
  phone: string;
  enterpriseId: number;
  departmentId: number;
}) {
  const [existing] = await db
    .select({ id: employees.id, enterpriseId: employees.enterpriseId })
    .from(employees)
    .where(eq(employees.phone, input.phone))
    .limit(1);
  let employeeId = existing?.id;
  if (!existing) {
    const [row] = await db
      .insert(employees)
      .values({
        name: input.name,
        phone: input.phone,
        passwordHash: await hashPassword(REGISTRATION_INITIAL_PASSWORD),
        role: "employee",
        status: "active",
        enterpriseId: input.enterpriseId,
        mustChangePassword: false,
      })
      .returning({ id: employees.id });
    employeeId = row.id;
  } else {
    await db
      .update(employees)
      .set({
        name: input.name,
        enterpriseId: input.enterpriseId,
        updatedAt: new Date(),
      })
      .where(eq(employees.id, existing.id));
  }
  const teamId = await ensureDefaultTeam(input.departmentId, input.enterpriseId);
  await db.insert(teamMembers).values({ teamId, employeeId: employeeId! }).onConflictDoNothing();
  return { id: employeeId! };
}

async function defaultDepartmentId(enterpriseId: number): Promise<number> {
  const [row] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.enterpriseId, enterpriseId), eq(departments.isDefault, true)))
    .limit(1);
  if (!row) throw new Error(`企业 ${enterpriseId} 缺少默认部门`);
  return row.id;
}

async function main() {
  try {
    const [group] = await db
      .select({
        id: enterprises.id,
        parentId: enterprises.parentId,
        dingtalkDeptId: enterprises.dingtalkDeptId,
      })
      .from(enterprises)
      .where(eq(enterprises.name, E2E_ORG.group.name))
      .limit(1);
    if (!group) {
      throw new Error(`缺少根企业 ${E2E_ORG.group.name}，请先 db:seed / migrate 0055`);
    }
    if (group.parentId != null || group.dingtalkDeptId !== E2E_ORG.group.dingtalkDeptId) {
      await db
        .update(enterprises)
        .set({ parentId: null, dingtalkDeptId: E2E_ORG.group.dingtalkDeptId })
        .where(eq(enterprises.id, group.id));
    }

    const childA = await ensureEnterprise({
      name: E2E_ORG.childA.name,
      parentId: group.id,
      dingtalkDeptId: E2E_ORG.childA.dingtalkDeptId,
    });
    const childB = await ensureEnterprise({
      name: E2E_ORG.childB.name,
      parentId: group.id,
      dingtalkDeptId: E2E_ORG.childB.dingtalkDeptId,
    });
    const department = await ensureNamedDepartment({
      name: E2E_ORG.department.name,
      enterpriseId: childA.id,
      dingtalkDeptId: E2E_ORG.department.dingtalkDeptId,
    });
    const departmentB = await ensureNamedDepartment({
      name: E2E_ORG.departmentB.name,
      enterpriseId: childA.id,
      dingtalkDeptId: E2E_ORG.departmentB.dingtalkDeptId,
    });
    const employeeA = await ensureEmployee({
      name: E2E_ORG.employees.childA.name,
      phone: E2E_ORG.employees.childA.phone,
      enterpriseId: childA.id,
      departmentId: department.id,
    });
    const teamB = await ensureDefaultTeam(departmentB.id, childA.id);
    await db.insert(teamMembers).values({ teamId: teamB, employeeId: employeeA.id }).onConflictDoNothing();
    const employeeB = await ensureEmployee({
      name: E2E_ORG.employees.childB.name,
      phone: E2E_ORG.employees.childB.phone,
      enterpriseId: childB.id,
      departmentId: await defaultDepartmentId(childB.id),
    });
    console.log("[e2e] org fixtures ready", {
      groupId: group.id,
      childA: childA.id,
      childB: childB.id,
      department: department.id,
      departmentB: departmentB.id,
      employeeA: employeeA.id,
      employeeB: employeeB.id,
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
