import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

/**
 * Failure modes for A1 (initial password Hz123456):
 * - Unique local password is treated as already rotated.
 * - Hz123456 hash requires DingTalk before a session.
 * - DingTalk pending state cannot swap employeeId.
 * - Pending DingTalk must land on the same employee; provision/none/other id fail.
 * - New password cannot be Hz123456.
 * - Forced-change sessions only reach /api/auth/me and /api/auth/change-password.
 */
const {
  REGISTRATION_INITIAL_PASSWORD,
  hashPassword,
  isInitialRegistrationPassword,
  validateNewPassword,
} = await import("../src/lib/password.js");
const {
  createDingtalkLoginState,
  readDingtalkLoginState,
  verifyDingtalkLoginState,
} = await import("../src/lib/dingtalk-oauth.js");
const { planDingtalkLoginMatch, matchPendingDingtalkEmployee } = await import(
  "../src/lib/dingtalk-login.js"
);
const { isAllowedDuringForcedPasswordChange } = await import("../src/lib/initial-password-gate.js");

const SECRET = "unit-test-jwt-secret";

test("Hz123456 hash is the initial password; a unique hash is not", async () => {
  const initial = await hashPassword(REGISTRATION_INITIAL_PASSWORD);
  const unique = await hashPassword("Unique@2026ab");
  assert.equal(await isInitialRegistrationPassword(initial), true);
  assert.equal(await isInitialRegistrationPassword(unique), false);
});

test("new passwords cannot reuse the shared initial password", () => {
  assert.equal(validateNewPassword("Hz123456"), "不能使用初始密码，请设置新密码");
  assert.equal(validateNewPassword("Unique@2026ab"), null);
});

test("DingTalk state can bind an employee and rejects a swapped id", () => {
  const issuedAt = 1_700_000_000_000;
  const state = createDingtalkLoginState(SECRET, issuedAt, 41);
  assert.equal(verifyDingtalkLoginState(SECRET, state, issuedAt), true);
  const parsed = readDingtalkLoginState(SECRET, state, issuedAt);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.employeeId, 41);

  const payload = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as {
    n: string;
    t: number;
    m: string;
    e?: number;
  };
  payload.e = 99;
  const swapped = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  assert.equal(verifyDingtalkLoginState(SECRET, swapped, issuedAt), false);
  assert.equal(readDingtalkLoginState(SECRET, swapped, issuedAt).ok, false);
});

test("pending DingTalk must match the same employee, not provision or another id", () => {
  const profile = { userid: "ding-1", name: "李四", mobile: "13900001111" };
  const self = { id: 41, dingtalkUserid: "ding-1", phone: "13900001111", status: "active" };
  const other = { id: 7, dingtalkUserid: "ding-other", phone: "13800000000", status: "active" };
  const matchSelf = planDingtalkLoginMatch(profile, [self, other]);
  assert.deepEqual(matchPendingDingtalkEmployee(matchSelf, 41), { ok: true });
  assert.deepEqual(matchPendingDingtalkEmployee(matchSelf, 7), { ok: false });
  assert.deepEqual(matchPendingDingtalkEmployee(matchSelf, undefined), { ok: true });
  assert.deepEqual(matchPendingDingtalkEmployee({ kind: "provision" }, 41), { ok: false });
  assert.deepEqual(matchPendingDingtalkEmployee({ kind: "none" }, 41), { ok: false });
});

test("forced password-change sessions only allow me and change-password", () => {
  assert.equal(isAllowedDuringForcedPasswordChange("/api/auth/me"), true);
  assert.equal(isAllowedDuringForcedPasswordChange("/api/auth/change-password"), true);
  assert.equal(isAllowedDuringForcedPasswordChange("/api/auth/me?x=1"), true);
  assert.equal(isAllowedDuringForcedPasswordChange("/api/me/keys"), false);
  assert.equal(isAllowedDuringForcedPasswordChange("/api/admin/users"), false);
  assert.equal(isAllowedDuringForcedPasswordChange("/api/auth/login"), false);
});
