import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const {
  lookupDingtalkProfileForRegister,
  planRegisterDingtalkJoin,
  registerDingtalkJoinMessage,
  REGISTER_DINGTALK_JOIN_MESSAGES,
} = await import("../src/lib/dingtalk-register-join.js");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const mapped = [
  {
    dingtalkDeptId: 660464349,
    departmentId: 175,
    enterpriseId: 2,
    departmentName: "南昌研发组",
  },
  {
    dingtalkDeptId: 855501967,
    departmentId: 12,
    enterpriseId: 2,
    departmentName: "海致科技",
  },
  {
    dingtalkDeptId: 9,
    departmentId: 88,
    enterpriseId: 3,
    departmentName: "海致星图",
  },
];

const profile = {
  userid: "0411",
  name: "吴家旺",
  mobile: "18397939872",
  deptIds: [855501967, 660464349, 9],
};

test("register join plan attaches every mapped department in one enterprise", () => {
  const plan = planRegisterDingtalkJoin({ status: "found", profile }, mapped);
  assert.equal(plan.status, "matched");
  if (plan.status !== "matched") return;
  assert.equal(plan.enterpriseId, 2);
  assert.deepEqual(
    plan.departments.map((row) => row.departmentName),
    ["海致科技", "南昌研发组"],
  );
  assert.equal(
    registerDingtalkJoinMessage(plan),
    REGISTER_DINGTALK_JOIN_MESSAGES.matched(["海致科技", "南昌研发组"]),
  );
});

test("register join plan keeps lookup failures and unmapped DingTalk departments", () => {
  assert.equal(planRegisterDingtalkJoin({ status: "not_found" }, mapped).status, "not_found");
  assert.equal(
    planRegisterDingtalkJoin({ status: "phone_mismatch" }, mapped).status,
    "phone_mismatch",
  );
  const mismatch = planRegisterDingtalkJoin(
    { status: "name_mismatch", dingtalkName: "张闯" },
    mapped,
  );
  assert.equal(mismatch.status, "name_mismatch");
  assert.equal(
    registerDingtalkJoinMessage(mismatch),
    REGISTER_DINGTALK_JOIN_MESSAGES.name_mismatch("张闯"),
  );
  assert.equal(
    planRegisterDingtalkJoin(
      { status: "found", profile: { ...profile, deptIds: [404] } },
      mapped,
    ).status,
    "unmapped",
  );
});

test("register lookup uses mobile then confirms the filled name", async () => {
  const calls: string[] = [];
  const lookup = await lookupDingtalkProfileForRegister({
    name: "吴家旺",
    phone: "+86 183-9793-9872",
    token: "tok",
    oapiBaseUrl: "https://oapi.dingtalk.com",
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      if (url.pathname === "/topapi/v2/user/getbymobile") {
        const payload = JSON.parse(String(init?.body ?? "{}")) as { mobile: string };
        assert.equal(payload.mobile, "18397939872");
        return jsonResponse({ errcode: 0, result: { userid: "0411" } });
      }
      if (url.pathname === "/topapi/v2/user/get") {
        return jsonResponse({
          errcode: 0,
          result: {
            userid: "0411",
            name: "吴家旺",
            mobile: "18397939872",
            dept_id_list: [660464349],
          },
        });
      }
      throw new Error(url.pathname);
    },
  });
  assert.deepEqual(calls, ["/topapi/v2/user/getbymobile", "/topapi/v2/user/get"]);
  assert.equal(lookup.status, "found");
  if (lookup.status !== "found") return;
  assert.equal(lookup.profile.userid, "0411");
});

test("register lookup rejects a mobile hit whose DingTalk name differs", async () => {
  const lookup = await lookupDingtalkProfileForRegister({
    name: "路人",
    phone: "18397939872",
    token: "tok",
    oapiBaseUrl: "https://oapi.dingtalk.com",
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/topapi/v2/user/getbymobile") {
        return jsonResponse({ errcode: 0, result: { userid: "0411" } });
      }
      if (url.pathname === "/topapi/v2/user/get") {
        return jsonResponse({
          errcode: 0,
          result: { userid: "0411", name: "吴家旺", mobile: "18397939872", dept_id_list: [1] },
        });
      }
      throw new Error(url.pathname);
    },
  });
  assert.deepEqual(lookup, { status: "name_mismatch", dingtalkName: "吴家旺" });
});

test("register lookup falls back to unique name then requires the same mobile", async () => {
  const calls: string[] = [];
  const found = await lookupDingtalkProfileForRegister({
    name: "吴家旺",
    phone: "18397939872",
    token: "tok",
    oapiBaseUrl: "https://oapi.dingtalk.com",
    contactBaseUrl: "https://api.dingtalk.com",
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      if (url.pathname === "/topapi/v2/user/getbymobile") {
        return jsonResponse({ errcode: 40104, errmsg: "企业中无效的手机号" });
      }
      if (url.pathname === "/v1.0/contact/users/search") {
        return jsonResponse({ hasMore: false, totalCount: 1, list: ["0411"] });
      }
      if (url.pathname === "/topapi/v2/user/get") {
        return jsonResponse({
          errcode: 0,
          result: {
            userid: "0411",
            name: "吴家旺",
            mobile: "+86 18397939872",
            dept_id_list: [660464349],
          },
        });
      }
      throw new Error(url.pathname);
    },
  });
  assert.deepEqual(calls, [
    "/topapi/v2/user/getbymobile",
    "/v1.0/contact/users/search",
    "/topapi/v2/user/get",
  ]);
  assert.equal(found.status, "found");

  const mismatched = await lookupDingtalkProfileForRegister({
    name: "吴家旺",
    phone: "13800001111",
    token: "tok",
    oapiBaseUrl: "https://oapi.dingtalk.com",
    contactBaseUrl: "https://api.dingtalk.com",
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/topapi/v2/user/getbymobile") {
        return jsonResponse({ errcode: 40104, errmsg: "企业中无效的手机号" });
      }
      if (url.pathname === "/v1.0/contact/users/search") {
        return jsonResponse({ hasMore: false, totalCount: 1, list: ["0411"] });
      }
      if (url.pathname === "/topapi/v2/user/get") {
        return jsonResponse({
          errcode: 0,
          result: {
            userid: "0411",
            name: "吴家旺",
            mobile: "18397939872",
            dept_id_list: [660464349],
          },
        });
      }
      throw new Error(url.pathname);
    },
  });
  assert.equal(mismatched.status, "phone_mismatch");
});

test("account register wires DingTalk join and reminds when unmatched", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const auth = readFileSync(resolve(root, "server/src/routes/auth.ts"), "utf8");
  const register = readFileSync(resolve(root, "web/src/views/RegisterView.vue"), "utf8");
  assert.match(auth, /tryJoinRegisteredEmployeeFromDingtalk/);
  assert.match(auth, /dingtalkJoined/);
  assert.match(register, /dingtalkJoined/);
  assert.match(register, /ElMessage\.warning/);
  assert.match(register, /Token Bot/);
});
