import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Fastify from "fastify";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const {
  DingtalkApiError,
  DingtalkNotConfiguredError,
  fetchDingtalkDeptUsers,
  fetchDingtalkDepartmentTree,
  readDingtalkCredentials,
} = await import("../src/lib/dingtalk-department-tree.js");
const { planDingtalkDeptIdWrites } = await import("../src/lib/dingtalk-dept-id-map.js");
const { planDingtalkUserImport } = await import("../src/lib/dingtalk-user-import.js");
const { adminEnterpriseDingtalkRoutes } = await import(
  "../src/routes/admin/enterprise-dingtalk.js"
);

const orgAdminSession = {
  sub: "9",
  role: "org_admin" as const,
  phone: "13800000009",
  name: "OrgAdmin",
  mustChangePassword: false,
  enterpriseId: 3,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fakeDingtalkFetch(options: {
  token?: string;
  departments?: Record<number, { name: string; parentId: number; children: number[] }>;
  names?: Record<number, string>;
  gettoken?: unknown;
  listsubError?: { errcode: number; errmsg: string };
}): typeof fetch {
  const departments = options.departments ?? {
    1: { name: "海致集团", parentId: 0, children: [2, 3, -7] },
    2: { name: "海致科技", parentId: 1, children: [4] },
    3: { name: "海致星图", parentId: 1, children: [] },
    4: { name: "研发", parentId: 2, children: [] },
    [-7]: { name: "家校通讯录", parentId: 1, children: [] },
  };
  return async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/gettoken") {
      if (options.gettoken) return jsonResponse(options.gettoken);
      return jsonResponse({
        errcode: 0,
        access_token: options.token ?? "tok",
        expires_in: 7200,
      });
    }
    const payload = init?.body ? (JSON.parse(String(init.body)) as { dept_id: number }) : { dept_id: 0 };
    if (url.pathname === "/topapi/v2/department/get") {
      const row = departments[payload.dept_id];
      return jsonResponse({
        errcode: 0,
        result: {
          dept_id: payload.dept_id,
          name: options.names?.[payload.dept_id] ?? row?.name ?? "根部门",
          parent_id: row?.parentId ?? 0,
        },
      });
    }
    if (url.pathname === "/topapi/v2/department/listsub") {
      if (options.listsubError) return jsonResponse(options.listsubError);
      const row = departments[payload.dept_id];
      return jsonResponse({
        errcode: 0,
        result: (row?.children ?? []).map((deptId) => ({
          dept_id: deptId,
          name: departments[deptId]?.name ?? `部门${deptId}`,
          parent_id: payload.dept_id,
        })),
      });
    }
    throw new Error(`unexpected ${url.pathname}`);
  };
}

test("blank DingTalk credentials are treated as missing", () => {
  assert.equal(readDingtalkCredentials({}), null);
  assert.equal(readDingtalkCredentials({ DINGTALK_APP_KEY: "key" }), null);
  assert.equal(readDingtalkCredentials({ DINGTALK_APP_SECRET: "secret" }), null);
  assert.deepEqual(
    readDingtalkCredentials({ DINGTALK_APP_KEY: " key ", DINGTALK_APP_SECRET: " secret " }),
    { appKey: "key", appSecret: "secret" },
  );
});

test("department tree recurses listsub from dept_id 1 and skips school contacts", async () => {
  const tree = await fetchDingtalkDepartmentTree({
    appKey: "key",
    appSecret: "secret",
    fetchImpl: fakeDingtalkFetch({}),
    baseUrl: "https://oapi.dingtalk.com",
  });
  assert.deepEqual(tree, {
    deptId: 1,
    name: "海致集团",
    parentId: 0,
    children: [
      {
        deptId: 2,
        name: "海致科技",
        parentId: 1,
        children: [{ deptId: 4, name: "研发", parentId: 2, children: [] }],
      },
      { deptId: 3, name: "海致星图", parentId: 1, children: [] },
    ],
  });
});

test("empty app key throws not-configured before calling DingTalk", async () => {
  await assert.rejects(
    () =>
      fetchDingtalkDepartmentTree({
        appKey: " ",
        appSecret: "secret",
        fetchImpl: async () => {
          throw new Error("should not fetch");
        },
      }),
    (error: unknown) => error instanceof DingtalkNotConfiguredError,
  );
});

test("gettoken errcode becomes a DingTalk API error", async () => {
  await assert.rejects(
    () =>
      fetchDingtalkDepartmentTree({
        appKey: "key",
        appSecret: "secret",
        fetchImpl: fakeDingtalkFetch({
          gettoken: { errcode: 40001, errmsg: "invalid appKey or appSecret" },
        }),
      }),
    (error: unknown) =>
      error instanceof DingtalkApiError
      && error.errcode === 40001
      && error.message === "invalid appKey or appSecret",
  );
});

test("listsub errcode becomes a DingTalk API error", async () => {
  await assert.rejects(
    () =>
      fetchDingtalkDepartmentTree({
        appKey: "key",
        appSecret: "secret",
        fetchImpl: fakeDingtalkFetch({
          listsubError: { errcode: 88, errmsg: "不合法的部门id" },
        }),
      }),
    (error: unknown) =>
      error instanceof DingtalkApiError && error.message === "不合法的部门id",
  );
});

test("unauthenticated and org_admin cannot read DingTalk departments", async () => {
  const app = Fastify();
  await app.register(adminEnterpriseDingtalkRoutes);
  await app.ready();
  try {
    const anonymous = await app.inject({
      method: "GET",
      url: "/api/admin/enterprise-dingtalk/departments",
    });
    assert.equal(anonymous.statusCode, 401);
  } finally {
    await app.close();
  }

  const scoped = Fastify();
  scoped.addHook("onRequest", async (req) => {
    req.session = orgAdminSession;
    req.employeeId = Number(orgAdminSession.sub);
  });
  await scoped.register(adminEnterpriseDingtalkRoutes);
  await scoped.ready();
  try {
    const forbidden = await scoped.inject({
      method: "GET",
      url: "/api/admin/enterprise-dingtalk/departments",
    });
    assert.equal(forbidden.statusCode, 403);
  } finally {
    await scoped.close();
  }
});

test("department user list paginates and keeps name, userid, mobile", async () => {
  const pages = [
    {
      errcode: 0,
      result: {
        has_more: true,
        next_cursor: 2,
        list: [{ userid: "u1", name: "甲", mobile: "13800000001" }],
      },
    },
    {
      errcode: 0,
      result: {
        has_more: false,
        list: [{ userid: "u2", name: "乙" }],
      },
    },
  ];
  const users = await fetchDingtalkDeptUsers({
    token: "tok",
    deptId: 10,
    baseUrl: "https://oapi.dingtalk.com",
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/topapi/v2/user/list");
      const payload = JSON.parse(String(init?.body ?? "{}")) as { dept_id: number; cursor: number };
      assert.equal(payload.dept_id, 10);
      return jsonResponse(pages.shift());
    },
  });
  assert.deepEqual(users, [
    { userid: "u1", name: "甲", mobile: "13800000001" },
    { userid: "u2", name: "乙", mobile: null },
  ]);
});

test("user import skips existing phones and people without a mobile", () => {
  const plan = planDingtalkUserImport({
    existingPhones: new Set(["18612243416"]),
    candidates: [
      {
        userid: "a",
        name: "已有",
        mobile: "+86 186-1224-3416",
        departmentId: 6,
        enterpriseId: 2,
        departmentName: "AI Native",
      },
      {
        userid: "b",
        name: "新人",
        mobile: "13800009999",
        departmentId: 6,
        enterpriseId: 2,
        departmentName: "AI Native",
      },
      {
        userid: "b2",
        name: "同号第二部门",
        mobile: "13800009999",
        departmentId: 14,
        enterpriseId: 2,
        departmentName: "售前咨询部",
      },
      {
        userid: "c",
        name: "无手机",
        mobile: null,
        departmentId: 6,
        enterpriseId: 2,
        departmentName: "AI Native",
      },
    ],
  });
  assert.deepEqual(
    plan.creates.map((row) => ({ name: row.name, phone: row.phone, departmentId: row.departmentId })),
    [{ name: "新人", phone: "13800009999", departmentId: 6 }],
  );
  assert.equal(plan.skippedExisting.length, 2);
  assert.equal(plan.skippedNoPhone.length, 1);
});

test("aligned DingTalk department ids are written by path and skipped depts stay unmatched", () => {
  const tree = {
    deptId: 1,
    name: "北京海致科技集团股份有限公司",
    parentId: 0,
    children: [
      {
        deptId: 10,
        name: "海致星图",
        parentId: 1,
        children: [
          { deptId: 11, name: "总裁办（星图）", parentId: 10, children: [] },
          { deptId: 12, name: "残疾人安置（星图）", parentId: 10, children: [] },
        ],
      },
      {
        deptId: 20,
        name: "海致科技",
        parentId: 1,
        children: [
          {
            deptId: 21,
            name: "新业务孵化中心",
            parentId: 20,
            children: [{ deptId: 22, name: "新行业五部", parentId: 21, children: [] }],
          },
          { deptId: 23, name: "外包团队", parentId: 20, children: [] },
          { deptId: 24, name: "残疾人安置（科技）", parentId: 20, children: [] },
        ],
      },
    ],
  };
  const plan = planDingtalkDeptIdWrites({
    tree,
    enterprises: [
      { id: 2, name: "海致科技" },
      { id: 3, name: "海致星图" },
    ],
    departments: [
      { id: 3, enterpriseId: 3, parentId: null, name: "默认部门", isDefault: true },
      { id: 53, enterpriseId: 3, parentId: null, name: "总裁办（星图）", isDefault: false },
      { id: 1, enterpriseId: 2, parentId: null, name: "默认部门", isDefault: true },
      { id: 12, enterpriseId: 2, parentId: null, name: "新业务孵化中心", isDefault: false },
      { id: 221, enterpriseId: 2, parentId: 12, name: "新行业五部", isDefault: false },
    ],
  });
  assert.deepEqual(
    plan.writes.map((row) => ({
      departmentId: row.departmentId,
      dingtalkDeptId: row.dingtalkDeptId,
      path: row.path,
    })),
    [
      { departmentId: 53, dingtalkDeptId: 11, path: ["总裁办（星图）"] },
      { departmentId: 12, dingtalkDeptId: 21, path: ["新业务孵化中心"] },
      { departmentId: 221, dingtalkDeptId: 22, path: ["新业务孵化中心", "新行业五部"] },
    ],
  );
  assert.equal(
    plan.skipped.map((row) => row.path.join("/")).sort().join(","),
    "外包团队,残疾人安置（星图）,残疾人安置（科技）",
  );
  assert.deepEqual(plan.unmatchedDingtalk, []);
});

test("env example and admin shell expose DingTalk credentials and blank page route", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const envExample = readFileSync(resolve(root, ".env.example"), "utf8");
  const config = readFileSync(resolve(root, "server/src/config.ts"), "utf8");
  const route = readFileSync(resolve(root, "server/src/routes/admin/enterprise-dingtalk.ts"), "utf8");
  const view = readFileSync(resolve(root, "web/src/views/admin/EnterpriseDingtalkView.vue"), "utf8");
  assert.match(envExample, /DINGTALK_APP_KEY=/);
  assert.match(envExample, /DINGTALK_APP_SECRET=/);
  assert.match(config, /DINGTALK_APP_KEY: optionalSecret/);
  assert.match(config, /DINGTALK_APP_SECRET: optionalSecret/);
  assert.match(route, /\/api\/admin\/enterprise-dingtalk\/departments/);
  assert.match(route, /DINGTALK_NOT_CONFIGURED/);
  const schema = readFileSync(resolve(root, "server/src/db/schema/index.ts"), "utf8");
  const migration = readFileSync(
    resolve(root, "server/drizzle/0045_department_dingtalk_dept_id.sql"),
    "utf8",
  );
  assert.match(schema, /dingtalkDeptId: bigint\("dingtalk_dept_id"/);
  assert.match(migration, /dingtalk_dept_id/);
  assert.match(view, /\/api\/admin\/enterprise-dingtalk\/departments/);
  assert.doesNotMatch(view, /class="page-title"/);
  assert.doesNotMatch(view, /class="page-subtitle"/);
});
