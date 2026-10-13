import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { E2E } from "./env.ts";
import { E2E_ORG, ORG_UNITS_SYNC_ONLY_MESSAGE } from "./org-fixture.ts";

/**
 * 企业层级 + 钉钉 dept_id：
 * 海致集团为根（dingtalkDeptId=1），下级企业挂 parentId，
 * 企业和部门都用 dingtalkDeptId 对齐钉钉通讯录，且全局不可重复。
 * 子公司和部门只能由钉钉同步（E2E 夹具模拟）创建，admin POST 返回 403。
 */
const ARTIFACT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "artifacts");

type Enterprise = {
  id: number;
  name: string;
  parentId: number | null;
  dingtalkDeptId: number | null;
};

type Department = {
  id: number;
  name: string;
  enterpriseId: number;
  dingtalkDeptId: number | null;
};

const state: { group?: Enterprise; childA?: Enterprise; childB?: Enterprise; department?: Department } = {};

async function loginToken(ctx: APIRequestContext) {
  const res = await ctx.post("/api/auth/login", {
    data: { phone: E2E.admin.phone, password: E2E.admin.password },
  });
  const body = (await res.json()) as { success?: boolean; data?: { token?: string } };
  expect(body.success === true && typeof body.data?.token === "string").toBeTruthy();
  return body.data!.token as string;
}

test.describe.serial("企业层级与钉钉部门 ID", () => {
  test("禁止手工新建子公司和部门；seed 海致集团为根并挂下级夹具", async ({ request }) => {
    const token = await loginToken(request);
    const headers = { Authorization: `Bearer ${token}` };

    const createEnterprise = await request.post("/api/admin/enterprises", {
      data: { name: "手工子公司" },
      headers,
    });
    const createEnterpriseBody = (await createEnterprise.json()) as { message?: string };
    expect(createEnterprise.status()).toBe(403);
    expect(createEnterpriseBody.message).toBe(ORG_UNITS_SYNC_ONLY_MESSAGE);

    const listRes = await request.get("/api/admin/enterprises", { headers });
    const listBody = (await listRes.json()) as { success: boolean; data: Enterprise[] };
    expect(listBody.success, `企业列表失败: ${JSON.stringify(listBody)}`).toBeTruthy();
    const group = listBody.data.find((row) => row.name === E2E_ORG.group.name);
    expect(group, `应有根企业 ${E2E_ORG.group.name}: ${JSON.stringify(listBody.data)}`).toBeTruthy();
    expect(group!.parentId).toBeNull();
    expect(group!.dingtalkDeptId).toBe(E2E_ORG.group.dingtalkDeptId);
    state.group = group!;

    const childA = listBody.data.find((row) => row.name === E2E_ORG.childA.name);
    const childB = listBody.data.find((row) => row.name === E2E_ORG.childB.name);
    expect(childA, `应有夹具 ${E2E_ORG.childA.name}`).toBeTruthy();
    expect(childB, `应有夹具 ${E2E_ORG.childB.name}`).toBeTruthy();
    expect(childA!.parentId).toBe(group!.id);
    expect(childB!.parentId).toBe(group!.id);
    expect(childA!.dingtalkDeptId).toBe(E2E_ORG.childA.dingtalkDeptId);
    expect(childB!.dingtalkDeptId).toBe(E2E_ORG.childB.dingtalkDeptId);
    state.childA = childA!;
    state.childB = childB!;

    const createDepartment = await request.post("/api/admin/departments", {
      data: { name: "手工部门", enterpriseId: childA!.id },
      headers,
    });
    const createDepartmentBody = (await createDepartment.json()) as { message?: string };
    expect(createDepartment.status()).toBe(403);
    expect(createDepartmentBody.message).toBe(ORG_UNITS_SYNC_ONLY_MESSAGE);

    const deptRes = await request.get(`/api/admin/departments?enterpriseId=${childA!.id}`, { headers });
    const deptBody = (await deptRes.json()) as { success: boolean; data: Department[] };
    expect(deptBody.success).toBeTruthy();
    const department = deptBody.data.find((row) => row.name === E2E_ORG.department.name);
    expect(department, `应有夹具部门 ${E2E_ORG.department.name}`).toBeTruthy();
    expect(department!.enterpriseId).toBe(childA!.id);
    expect(department!.dingtalkDeptId).toBe(E2E_ORG.department.dingtalkDeptId);
    state.department = department!;

    mkdirSync(ARTIFACT_DIR, { recursive: true });
    writeFileSync(
      resolve(ARTIFACT_DIR, "enterprise-hierarchy.json"),
      `${JSON.stringify({
        enterprises: listBody.data.map((row) => ({
          id: row.id,
          name: row.name,
          parentId: row.parentId,
          dingtalkDeptId: row.dingtalkDeptId,
        })),
      }, null, 2)}\n`,
    );
  });

  test("钉钉 dept_id 在企业与部门间全局唯一，禁止把上级设成自己的下级", async ({ request }) => {
    const token = await loginToken(request);
    const headers = { Authorization: `Bearer ${token}` };
    expect(state.group && state.childA && state.department).toBeTruthy();

    const dupEnterprise = await request.patch(`/api/admin/enterprises/${state.childA!.id}`, {
      data: { dingtalkDeptId: E2E_ORG.group.dingtalkDeptId },
      headers,
    });
    const dupEnterpriseBody = (await dupEnterprise.json()) as { message?: string };
    expect(dupEnterprise.status()).toBe(409);
    expect(dupEnterpriseBody.message).toContain("钉钉部门 ID");

    const dupDepartment = await request.patch(`/api/admin/departments/${state.department!.id}`, {
      data: { dingtalkDeptId: E2E_ORG.childA.dingtalkDeptId },
      headers,
    });
    const dupDepartmentBody = (await dupDepartment.json()) as { message?: string };
    expect(dupDepartment.status()).toBe(409);
    expect(dupDepartmentBody.message).toContain("钉钉部门 ID");

    const cycle = await request.patch(`/api/admin/enterprises/${state.group!.id}`, {
      data: { parentId: state.childA!.id },
      headers,
    });
    const cycleBody = (await cycle.json()) as { message?: string };
    expect(cycle.status()).toBe(400);
    expect(cycleBody.message).toBe("上级企业不能选自己的下级");

    const selfParent = await request.patch(`/api/admin/enterprises/${state.childA!.id}`, {
      data: { parentId: state.childA!.id },
      headers,
    });
    const selfBody = (await selfParent.json()) as { message?: string };
    expect(selfParent.status()).toBe(400);
    expect(selfBody.message).toBe("上级企业不能是自己");
  });

  test("集团含下级时列出下级企业员工，且不返回超级管理员", async ({ request }) => {
    const token = await loginToken(request);
    const headers = { Authorization: `Bearer ${token}` };
    expect(state.group && state.childA && state.childB).toBeTruthy();

    type UserList = { success: boolean; data: Array<{ name: string; role: string; enterpriseId: number | null }>; total: number };
    const names = (body: UserList) => body.data.map((row) => row.name);

    const exactGroup = (await (
      await request.get(`/api/admin/users?enterpriseId=${state.group!.id}&limit=50`, { headers })
    ).json()) as UserList;
    expect(exactGroup.success).toBeTruthy();
    expect(exactGroup.data.every((row) => row.role !== "admin")).toBeTruthy();
    expect(names(exactGroup)).not.toContain(E2E.admin.name);
    expect(names(exactGroup)).not.toContain(E2E_ORG.employees.childA.name);
    expect(names(exactGroup)).not.toContain(E2E_ORG.employees.childB.name);

    const groupTree = (await (
      await request.get(
        `/api/admin/users?enterpriseId=${state.group!.id}&includeDescendants=true&limit=50`,
        { headers },
      )
    ).json()) as UserList;
    expect(groupTree.success).toBeTruthy();
    expect(groupTree.data.every((row) => row.role !== "admin")).toBeTruthy();
    expect(names(groupTree)).toContain(E2E_ORG.employees.childA.name);
    expect(names(groupTree)).toContain(E2E_ORG.employees.childB.name);
    expect(names(groupTree)).not.toContain(E2E.admin.name);

    const childAOnly = (await (
      await request.get(
        `/api/admin/users?enterpriseId=${state.childA!.id}&includeDescendants=true&limit=50`,
        { headers },
      )
    ).json()) as UserList;
    expect(names(childAOnly)).toContain(E2E_ORG.employees.childA.name);
    expect(names(childAOnly)).not.toContain(E2E_ORG.employees.childB.name);

    mkdirSync(ARTIFACT_DIR, { recursive: true });
    writeFileSync(
      resolve(ARTIFACT_DIR, "enterprise-group-people.json"),
      `${JSON.stringify({
        groupOnly: names(exactGroup),
        groupWithDescendants: names(groupTree),
        childAWithDescendants: names(childAOnly),
      }, null, 2)}\n`,
    );
  });

  test("员工列表可按是否在企业钉钉通讯录筛选", async ({ request }) => {
    const token = await loginToken(request);
    const headers = { Authorization: `Bearer ${token}` };
    expect(state.group).toBeTruthy();

    type UserList = {
      success: boolean;
      data: Array<{ name: string; isDingtalk?: boolean }>;
      total: number;
    };
    const names = (body: UserList) => body.data.map((row) => row.name);
    const base = `/api/admin/users?enterpriseId=${state.group!.id}&includeDescendants=true&limit=50`;

    const inRoster = (await (await request.get(`${base}&isDingtalk=true`, { headers })).json()) as UserList;
    expect(inRoster.success).toBeTruthy();
    expect(names(inRoster)).toContain(E2E_ORG.employees.childA.name);
    expect(names(inRoster)).not.toContain(E2E_ORG.employees.childB.name);
    expect(inRoster.data.every((row) => row.isDingtalk === true)).toBeTruthy();

    const outRoster = (await (await request.get(`${base}&isDingtalk=false`, { headers })).json()) as UserList;
    expect(outRoster.success).toBeTruthy();
    expect(names(outRoster)).toContain(E2E_ORG.employees.childB.name);
    expect(names(outRoster)).not.toContain(E2E_ORG.employees.childA.name);
    expect(outRoster.data.every((row) => row.isDingtalk === false)).toBeTruthy();

    mkdirSync(ARTIFACT_DIR, { recursive: true });
    writeFileSync(
      resolve(ARTIFACT_DIR, "employee-dingtalk-filter.json"),
      `${JSON.stringify({
        inRoster: names(inRoster),
        outRoster: names(outRoster),
      }, null, 2)}\n`,
    );
  });
});
