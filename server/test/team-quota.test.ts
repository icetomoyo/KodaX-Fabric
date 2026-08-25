import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";
process.env.QUOTA_TIMEZONE = "Asia/Shanghai";

const {
  assertEnterprisePackageAssigned,
  assertMemberLimitNotExceeded,
  assertTeamBound,
  assertTeamQuotaAssigned,
  assertTeamQuotaNotExceeded,
  relayLimitResponse,
  RelayLimitError,
} = await import("../src/lib/relay/quota.js");
const { usageIncrementTargets } = await import("../src/lib/relay/audit.js");
const { isTokenQuotaUnit, teamQuotaFitsEnterprise, TOKEN_QUOTA_UNIT } = await import(
  "../src/lib/team-quota.js"
);
const { ENTERPRISE_PACKAGE_PLANS, packageMonthlyYuan } = await import(
  "../src/lib/enterprise-package.js"
);

function isLimitError(code: string) {
  return (error: unknown) => error instanceof RelayLimitError && error.code === code;
}

test("relay rejects a Key that is not bound to a team", () => {
  assert.throws(() => assertTeamBound(null), isLimitError("team_required"));
  assert.throws(() => assertTeamBound(undefined), isLimitError("team_required"));
  assert.doesNotThrow(() => assertTeamBound(8));
});

test("quota configuration unit is one million tokens", () => {
  assert.equal(TOKEN_QUOTA_UNIT, 1_000_000);
  assert.equal(isTokenQuotaUnit(0), true);
  assert.equal(isTokenQuotaUnit(1_000_000), true);
  assert.equal(isTokenQuotaUnit(2_000_000), true);
  assert.equal(isTokenQuotaUnit(1), false);
  assert.equal(isTokenQuotaUnit(1_000_001), false);
});

test("enterprise packages are Plus 10000 / Pro 50000 / Max 200000 yuan per month", () => {
  assert.equal(ENTERPRISE_PACKAGE_PLANS.plus.monthlyYuan, 10_000);
  assert.equal(ENTERPRISE_PACKAGE_PLANS.pro.monthlyYuan, 50_000);
  assert.equal(ENTERPRISE_PACKAGE_PLANS.max.monthlyYuan, 200_000);
  assert.equal(packageMonthlyYuan(null), 0);
  assert.equal(packageMonthlyYuan("plus"), 10_000);
});

test("enterprise package of zero is treated as unassigned and denied", () => {
  assert.throws(
    () => assertEnterprisePackageAssigned(0),
    isLimitError("enterprise_quota_not_assigned"),
  );
  assert.throws(
    () => assertEnterprisePackageAssigned(-1),
    isLimitError("enterprise_quota_not_assigned"),
  );
  assert.doesNotThrow(() => assertEnterprisePackageAssigned(10_000));
});

test("team monthly quota of zero is treated as unassigned and denied", () => {
  assert.throws(() => assertTeamQuotaAssigned(0), isLimitError("team_quota_not_assigned"));
  assert.throws(() => assertTeamQuotaAssigned(-1), isLimitError("team_quota_not_assigned"));
  assert.doesNotThrow(() => assertTeamQuotaAssigned(1));
});

test("enterprise package of zero blocks assigning any positive team quota", () => {
  assert.equal(
    teamQuotaFitsEnterprise(0, 0, 1_000),
    "企业尚未获得套餐，无法给团队分配额度",
  );
  assert.equal(teamQuotaFitsEnterprise(0, 0, 0), null);
});

test("team quotas cannot exceed the enterprise package amount", () => {
  assert.equal(teamQuotaFitsEnterprise(10_000, 4_000, 6_000), null);
  assert.equal(
    teamQuotaFitsEnterprise(10_000, 4_000, 6_001),
    "团队额度合计不能超过企业套餐金额",
  );
});

test("team pool blocks forwarding once this month cost reaches the quota", () => {
  assert.doesNotThrow(() => assertTeamQuotaNotExceeded(99.99, 100));
  assert.throws(() => assertTeamQuotaNotExceeded(100, 100), isLimitError("team_quota_exceeded"));
  assert.throws(() => assertTeamQuotaNotExceeded(100.01, 100), isLimitError("team_quota_exceeded"));
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
    relayLimitResponse(
      new RelayLimitError("企业尚未获得套餐，无法转发", "enterprise_quota_not_assigned"),
    ),
    { status: 403, type: "permission_error" },
  );
  assert.deepEqual(
    relayLimitResponse(new RelayLimitError("团队尚未分配每月额度，无法转发", "team_quota_not_assigned")),
    { status: 403, type: "permission_error" },
  );
  assert.deepEqual(
    relayLimitResponse(new RelayLimitError("团队本月套餐额度已用尽", "team_quota_exceeded")),
    { status: 429, type: "rate_limit_error" },
  );
  assert.deepEqual(
    relayLimitResponse(new RelayLimitError("今日个人 Token 上限已用尽", "member_limit_exceeded")),
    { status: 429, type: "rate_limit_error" },
  );
});
