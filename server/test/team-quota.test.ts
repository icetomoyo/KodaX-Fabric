import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";
process.env.QUOTA_TIMEZONE = "Asia/Shanghai";

const {
  assertMemberLimitNotExceeded,
  assertTeamBound,
  assertTeamQuotaAssigned,
  assertTeamQuotaNotExceeded,
  relayLimitResponse,
  RelayLimitError,
} = await import("../src/lib/relay/quota.js");
const { usageIncrementTargets } = await import("../src/lib/relay/audit.js");

function isLimitError(code: string) {
  return (error: unknown) => error instanceof RelayLimitError && error.code === code;
}

test("relay rejects a Key that is not bound to a team", () => {
  assert.throws(() => assertTeamBound(null), isLimitError("team_required"));
  assert.throws(() => assertTeamBound(undefined), isLimitError("team_required"));
  assert.doesNotThrow(() => assertTeamBound(8));
});

test("team daily quota of zero is treated as unassigned and denied", () => {
  assert.throws(() => assertTeamQuotaAssigned(0), isLimitError("team_quota_not_assigned"));
  assert.throws(() => assertTeamQuotaAssigned(-1), isLimitError("team_quota_not_assigned"));
  assert.doesNotThrow(() => assertTeamQuotaAssigned(1));
});

test("team pool blocks forwarding once today total reaches the quota", () => {
  assert.doesNotThrow(() => assertTeamQuotaNotExceeded(99, 100));
  assert.throws(() => assertTeamQuotaNotExceeded(100, 100), isLimitError("team_quota_exceeded"));
  assert.throws(() => assertTeamQuotaNotExceeded(101, 100), isLimitError("team_quota_exceeded"));
});

test("member daily limit blocks only when a limit is set and reached", () => {
  assert.doesNotThrow(() => assertMemberLimitNotExceeded(1_000, null));
  assert.doesNotThrow(() => assertMemberLimitNotExceeded(1_000, undefined));
  assert.doesNotThrow(() => assertMemberLimitNotExceeded(49, 50));
  assert.throws(() => assertMemberLimitNotExceeded(50, 50), isLimitError("member_limit_exceeded"));
  assert.throws(() => assertMemberLimitNotExceeded(0, 0), isLimitError("member_limit_exceeded"));
});

test("relay writes employee daily counters and dual-writes team daily when bound", () => {
  assert.deepEqual(usageIncrementTargets(null), { employeeDaily: true, teamDaily: false });
  assert.deepEqual(usageIncrementTargets(undefined), { employeeDaily: true, teamDaily: false });
  assert.deepEqual(usageIncrementTargets(12), { employeeDaily: true, teamDaily: true });
});

test("quota rejection responses match the existing relay limit shape", () => {
  assert.deepEqual(
    relayLimitResponse(new RelayLimitError("API Key 未绑定团队，无法转发", "team_required")),
    { status: 403, type: "permission_error" },
  );
  assert.deepEqual(
    relayLimitResponse(new RelayLimitError("团队尚未分配每日 Token 额度", "team_quota_not_assigned")),
    { status: 403, type: "permission_error" },
  );
  assert.deepEqual(
    relayLimitResponse(new RelayLimitError("团队今日 Token 配额已用尽", "team_quota_exceeded")),
    { status: 429, type: "rate_limit_error" },
  );
  assert.deepEqual(
    relayLimitResponse(new RelayLimitError("今日个人 Token 上限已用尽", "member_limit_exceeded")),
    { status: 429, type: "rate_limit_error" },
  );
});
