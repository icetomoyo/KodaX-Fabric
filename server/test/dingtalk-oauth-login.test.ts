import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const {
  DINGTALK_OAUTH_AUTHORIZE_URL,
  buildDingtalkAuthorizeUrl,
  createDingtalkLoginState,
  verifyDingtalkLoginState,
  isAllowedDingtalkRedirectUri,
  exchangeDingtalkUserAccessToken,
  fetchDingtalkOauthContactMe,
} = await import("../src/lib/dingtalk-oauth.js");
const { planDingtalkLoginMatch } = await import("../src/lib/dingtalk-login.js");
const { fetchDingtalkUseridByUnionid } = await import("../src/lib/dingtalk-department-tree.js");

const SECRET = "unit-test-jwt-secret";

test("authorize URL encodes redirect, openid corpid scope, and state", () => {
  const url = buildDingtalkAuthorizeUrl({
    clientId: "ding-app-key",
    redirectUri: "https://tokenhub.haizhi.com/login/dingtalk",
    state: "abc+/=",
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, DINGTALK_OAUTH_AUTHORIZE_URL);
  assert.equal(parsed.searchParams.get("client_id"), "ding-app-key");
  assert.equal(parsed.searchParams.get("response_type"), "code");
  assert.equal(parsed.searchParams.get("prompt"), "consent");
  assert.equal(parsed.searchParams.get("scope"), "openid corpid");
  assert.equal(parsed.searchParams.get("state"), "abc+/=");
  assert.equal(
    parsed.searchParams.get("redirect_uri"),
    "https://tokenhub.haizhi.com/login/dingtalk",
  );
});

test("login state rejects tampered, expired, and empty values", () => {
  const issuedAt = 1_700_000_000_000;
  const state = createDingtalkLoginState(SECRET, issuedAt);
  assert.equal(verifyDingtalkLoginState(SECRET, state, issuedAt), true);
  assert.equal(verifyDingtalkLoginState("other-secret", state, issuedAt), false);
  const payload = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as {
    n: string;
    t: number;
    m: string;
  };
  payload.n = "0".repeat(payload.n.length);
  const tampered = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  assert.equal(verifyDingtalkLoginState(SECRET, tampered, issuedAt), false);
  assert.equal(verifyDingtalkLoginState(SECRET, "", issuedAt), false);
  assert.equal(verifyDingtalkLoginState(SECRET, "not-base64", issuedAt), false);
  assert.equal(verifyDingtalkLoginState(SECRET, state, issuedAt + 11 * 60 * 1000), false);
});

test("redirect URI allow-list is exact match only", () => {
  const allowed = [
    "https://tokenhub.haizhi.com/login/dingtalk",
    "http://127.0.0.1:5173/login/dingtalk",
  ];
  assert.equal(isAllowedDingtalkRedirectUri(allowed[0]!, allowed), true);
  assert.equal(isAllowedDingtalkRedirectUri(`${allowed[0]}/`, allowed), false);
  assert.equal(isAllowedDingtalkRedirectUri("https://evil.example/login/dingtalk", allowed), false);
  assert.equal(isAllowedDingtalkRedirectUri("http://127.0.0.1:5173/login", allowed), false);
});

test("userAccessToken exchange fails on HTTP error, missing token, and expired code", async () => {
  const missing = await exchangeDingtalkUserAccessToken({
    clientId: "k",
    clientSecret: "s",
    code: "bad",
    fetchImpl: async () =>
      new Response(JSON.stringify({ code: "invalidParameter.authCode.expired", message: "expired" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
  });
  assert.equal(missing.ok, false);

  const empty = await exchangeDingtalkUserAccessToken({
    clientId: "k",
    clientSecret: "s",
    code: "ok",
    fetchImpl: async () =>
      new Response(JSON.stringify({ expireIn: 7200 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  assert.equal(empty.ok, false);

  const ok = await exchangeDingtalkUserAccessToken({
    clientId: "k",
    clientSecret: "s",
    code: "ok",
    fetchImpl: async () =>
      new Response(JSON.stringify({ accessToken: "uat", expireIn: 7200, corpId: "corp" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  assert.deepEqual(ok, { ok: true, accessToken: "uat", corpId: "corp" });
});

test("oauth contact me fails without unionId", async () => {
  const missing = await fetchDingtalkOauthContactMe({
    userAccessToken: "uat",
    fetchImpl: async () =>
      new Response(JSON.stringify({ nick: "张三" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  assert.equal(missing.ok, false);

  const ok = await fetchDingtalkOauthContactMe({
    userAccessToken: "uat",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          nick: "张三",
          unionId: "union-1",
          openId: "open-1",
          mobile: "+86-13800138000",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.unionId, "union-1");
    assert.equal(ok.mobile, "+86-13800138000");
    assert.equal(ok.nick, "张三");
  }
});

test("getbyunionid treats absent user and external contact as not in corp", async () => {
  const absent = await fetchDingtalkUseridByUnionid({
    token: "tok",
    unionid: "u1",
    fetchImpl: async () =>
      new Response(JSON.stringify({ errcode: 60121, errmsg: "not found" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  assert.equal(absent, null);

  const external = await fetchDingtalkUseridByUnionid({
    token: "tok",
    unionid: "u1",
    fetchImpl: async () =>
      new Response(JSON.stringify({ errcode: 0, result: { userid: "ext", contact_type: 1 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  assert.equal(external, null);

  const employee = await fetchDingtalkUseridByUnionid({
    token: "tok",
    unionid: "u1",
    fetchImpl: async () =>
      new Response(JSON.stringify({ errcode: 0, result: { userid: "emp-9", contact_type: 0 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  assert.deepEqual(employee, { userid: "emp-9", contactType: 0 });
});

test("login match prefers dingtalk userid, then phone, else provision or none", () => {
  const profile = {
    userid: "ding-1",
    name: "李四",
    mobile: "13900001111",
    deptIds: [855501967],
  };
  const employees = [
    { id: 2, dingtalkUserid: "ding-1", phone: "18600000000", status: "active" },
    { id: 3, dingtalkUserid: null, phone: "13900001111", status: "active" },
  ];
  assert.deepEqual(planDingtalkLoginMatch(profile, employees), {
    kind: "userid",
    employeeId: 2,
  });
  assert.deepEqual(
    planDingtalkLoginMatch(profile, [employees[1]!]),
    { kind: "phone", employeeId: 3 },
  );
  assert.deepEqual(planDingtalkLoginMatch(profile, []), { kind: "provision" });
  assert.deepEqual(
    planDingtalkLoginMatch({ ...profile, mobile: null, name: "" }, []),
    { kind: "none" },
  );
});
