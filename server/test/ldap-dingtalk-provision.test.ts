import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const {
  lookupDingtalkProfileForLdapPerson,
  planLdapDingtalkProvision,
} = await import("../src/lib/ldap-dingtalk-provision.js");

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
];

test("provision plan needs name, phone, and a mapped department", () => {
  const profile = {
    userid: "0411",
    name: "吴家旺",
    mobile: "18397939872",
    deptIds: [660464349, 9],
  };
  assert.deepEqual(planLdapDingtalkProvision(profile, mapped), {
    name: "吴家旺",
    phone: "18397939872",
    departmentId: 175,
    enterpriseId: 2,
    departmentName: "南昌研发组",
    userid: "0411",
  });
  assert.equal(planLdapDingtalkProvision({ ...profile, mobile: null }, mapped), null);
  assert.equal(planLdapDingtalkProvision({ ...profile, deptIds: [9] }, mapped), null);
});

test("lookup searches DingTalk by exact Chinese name then loads that userid", async () => {
  const calls: string[] = [];
  const profile = await lookupDingtalkProfileForLdapPerson({
    person: { displayName: "吴家旺" },
    token: "tok",
    oapiBaseUrl: "https://oapi.dingtalk.com",
    contactBaseUrl: "https://api.dingtalk.com",
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      if (url.pathname === "/v1.0/contact/users/search") {
        const payload = JSON.parse(String(init?.body ?? "{}")) as {
          queryWord: string;
          fullMatchField: number;
        };
        assert.equal(payload.queryWord, "吴家旺");
        assert.equal(payload.fullMatchField, 1);
        return jsonResponse({ hasMore: false, totalCount: 1, list: ["04112616416121469240"] });
      }
      if (url.pathname === "/topapi/v2/user/get") {
        const payload = JSON.parse(String(init?.body ?? "{}")) as { userid: string };
        assert.equal(payload.userid, "04112616416121469240");
        return jsonResponse({
          errcode: 0,
          result: {
            userid: "04112616416121469240",
            name: "吴家旺",
            mobile: "18397939872",
            dept_id_list: [660464349],
          },
        });
      }
      throw new Error(url.pathname);
    },
  });
  assert.deepEqual(calls, ["/v1.0/contact/users/search", "/topapi/v2/user/get"]);
  assert.equal(profile?.userid, "04112616416121469240");
  assert.equal(profile?.mobile, "18397939872");
});

test("lookup returns null when the Chinese name is missing or not unique", async () => {
  assert.equal(
    await lookupDingtalkProfileForLdapPerson({
      person: { displayName: null },
      token: "tok",
      fetchImpl: async () => {
        throw new Error("should not fetch");
      },
    }),
    null,
  );

  const missing = await lookupDingtalkProfileForLdapPerson({
    person: { displayName: "路人" },
    token: "tok",
    contactBaseUrl: "https://api.dingtalk.com",
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/v1.0/contact/users/search");
      return jsonResponse({ hasMore: false, totalCount: 0, list: [] });
    },
  });
  assert.equal(missing, null);

  const duplicated = await lookupDingtalkProfileForLdapPerson({
    person: { displayName: "张闯" },
    token: "tok",
    contactBaseUrl: "https://api.dingtalk.com",
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/v1.0/contact/users/search");
      return jsonResponse({ hasMore: false, totalCount: 2, list: ["u1", "u2"] });
    },
  });
  assert.equal(duplicated, null);
});
