import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";
process.env.QUOTA_TIMEZONE = "Asia/Shanghai";

const {
  assertTeamBound,
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

test("relay writes employee daily counters and dual-writes team daily when bound", () => {
  assert.deepEqual(usageIncrementTargets(9), { employeeDaily: true, teamDaily: true });
  assert.deepEqual(usageIncrementTargets(null), { employeeDaily: true, teamDaily: false });
});

test("quota rejection responses match the existing relay limit shape", () => {
  assert.deepEqual(
    relayLimitResponse(new RelayLimitError("API Key 未绑定团队，无法转发", "team_required")),
    { status: 403, type: "permission_error" },
  );
  assert.deepEqual(
    relayLimitResponse(new RelayLimitError("请求过于频繁，请稍后重试", "rate_limit_exceeded", 12)),
    { status: 429, type: "rate_limit_error" },
  );
});
