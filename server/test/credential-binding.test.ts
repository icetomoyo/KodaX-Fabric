import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const { classifyUsageTier } = await import("../src/lib/usage-tier.js");
const { isOpenPoolProvider } = await import("../src/lib/relay/open-pool.js");
const {
  bindingStillNeeded,
  enterpriseIdForBindingScope,
  idleBindingIds,
  resolveBindingScope,
  resolveBindingScopeFromPeak,
  unusedBindingIds,
} = await import("../src/lib/relay/binding.js");

test("custom self-hosted channels skip usage-tier Key binding", () => {
  assert.equal(isOpenPoolProvider("custom"), true);
  assert.equal(isOpenPoolProvider("glm"), false);
  assert.equal(isOpenPoolProvider(null), false);
});

test("heavy always binds to the employee, ignoring team and department", () => {
  assert.deepEqual(
    resolveBindingScope({
      employeeId: 11,
      usageTier: "heavy",
      teamId: 22,
      departmentId: 44,
      enterpriseId: 33,
    }),
    { scopeType: "employee", scopeId: 11 },
  );
  assert.deepEqual(
    resolveBindingScope({
      employeeId: 11,
      usageTier: "heavy",
      teamId: null,
      departmentId: null,
      enterpriseId: null,
    }),
    { scopeType: "employee", scopeId: 11 },
  );
});

test("standard with a department shares the department Key", () => {
  assert.deepEqual(
    resolveBindingScope({
      employeeId: 11,
      usageTier: "standard",
      teamId: 22,
      departmentId: 44,
      enterpriseId: 33,
    }),
    { scopeType: "department", scopeId: 44 },
  );
});

test("standard without a department cannot resolve a scope", () => {
  assert.equal(
    resolveBindingScope({
      employeeId: 11,
      usageTier: "standard",
      teamId: 22,
      departmentId: null,
      enterpriseId: 33,
    }),
    null,
  );
});

test("standard without a department or enterprise cannot resolve a scope", () => {
  assert.equal(
    resolveBindingScope({
      employeeId: 11,
      usageTier: "standard",
      teamId: null,
      departmentId: null,
      enterpriseId: null,
    }),
    null,
  );
});

test("unused average is idle and holds no channel Key", () => {
  assert.equal(classifyUsageTier(0), "idle");
  for (const average of [null, 0]) {
    assert.equal(
      resolveBindingScopeFromPeak({
        employeeId: 29,
        averageDailyTokens: average,
        teamId: 4,
        departmentId: 8,
        enterpriseId: 2,
      }),
      null,
      `average=${String(average)} classified as ${classifyUsageTier(average)}`,
    );
  }
});

test("quiet usage shares the department Key", () => {
  for (const average of [1, 699_847]) {
    assert.deepEqual(
      resolveBindingScopeFromPeak({
        employeeId: 29,
        averageDailyTokens: average,
        teamId: 4,
        departmentId: 8,
        enterpriseId: 2,
      }),
      { scopeType: "department", scopeId: 8 },
      `average=${String(average)} classified as ${classifyUsageTier(average)}`,
    );
  }
});

test("idle has no binding scope", () => {
  assert.equal(
    resolveBindingScope({
      employeeId: 29,
      usageTier: "idle",
      teamId: 4,
      departmentId: 8,
      enterpriseId: 2,
    }),
    null,
  );
});

test("an idle user does not keep an exclusive or department Key", () => {
  const people = [
    {
      id: 1,
      usageTier: "idle" as const,
      teamId: 10,
      departmentId: 8,
      enterpriseId: 2,
    },
  ];
  assert.equal(bindingStillNeeded({ scopeType: "employee", scopeId: 1 }, people), false);
  assert.equal(bindingStillNeeded({ scopeType: "department", scopeId: 8 }, people), false);
  assert.deepEqual(
    unusedBindingIds(
      [
        { id: 1, scopeType: "employee", scopeId: 1 },
        { id: 2, scopeType: "department", scopeId: 8 },
      ],
      people,
    ),
    [1, 2],
  );
});

test("low usage still shares the department Key", () => {
  assert.deepEqual(
    resolveBindingScopeFromPeak({
      employeeId: 29,
      averageDailyTokens: 66_797,
      teamId: 4,
      departmentId: 8,
      enterpriseId: 2,
    }),
    { scopeType: "department", scopeId: 8 },
  );
  assert.deepEqual(
    resolveBindingScope({
      employeeId: 29,
      usageTier: "standard",
      teamId: 4,
      departmentId: 8,
      enterpriseId: 2,
    }),
    { scopeType: "department", scopeId: 8 },
  );
});

test("enterprise binding is unused after light tier is removed", () => {
  const people = [
    {
      id: 1,
      usageTier: "standard" as const,
      teamId: 10,
      departmentId: 8,
      enterpriseId: 2,
    },
    {
      id: 2,
      usageTier: "heavy" as const,
      teamId: 10,
      departmentId: 8,
      enterpriseId: 2,
    },
  ];
  assert.equal(
    bindingStillNeeded({ scopeType: "enterprise", scopeId: 2 }, people),
    false,
  );
  assert.deepEqual(
    unusedBindingIds([{ id: 78, scopeType: "enterprise", scopeId: 2 }], people),
    [78],
  );
});

test("department binding is unused after the last standard member becomes heavy", () => {
  const people = [
    {
      id: 1,
      usageTier: "heavy" as const,
      teamId: 10,
      departmentId: 8,
      enterpriseId: 2,
    },
    {
      id: 2,
      usageTier: "idle" as const,
      teamId: 10,
      departmentId: 8,
      enterpriseId: 2,
    },
  ];
  assert.equal(bindingStillNeeded({ scopeType: "department", scopeId: 8 }, people), false);
  assert.equal(
    bindingStillNeeded({ scopeType: "employee", scopeId: 1 }, people),
    true,
  );
});

test("leftover team bindings are unused after department share", () => {
  const people = [
    {
      id: 2,
      usageTier: "standard" as const,
      teamId: 10,
      departmentId: 8,
      enterpriseId: 2,
    },
  ];
  assert.equal(bindingStillNeeded({ scopeType: "team", scopeId: 10 }, people), false);
  assert.equal(bindingStillNeeded({ scopeType: "department", scopeId: 8 }, people), true);
});

test("shared bindings stay when someone still resolves onto them", () => {
  const people = [
    {
      id: 1,
      usageTier: "idle" as const,
      teamId: 10,
      departmentId: 8,
      enterpriseId: 2,
    },
    {
      id: 2,
      usageTier: "standard" as const,
      teamId: 10,
      departmentId: 8,
      enterpriseId: 2,
    },
  ];
  assert.equal(
    bindingStillNeeded({ scopeType: "enterprise", scopeId: 2 }, people),
    false,
  );
  assert.equal(bindingStillNeeded({ scopeType: "department", scopeId: 8 }, people), true);
  assert.deepEqual(
    unusedBindingIds(
      [
        { id: 1, scopeType: "enterprise", scopeId: 2 },
        { id: 2, scopeType: "department", scopeId: 8 },
      ],
      people,
    ),
    [1],
  );
});

test("a bound channel Key with no tokens and no credits for 5 hours is released", () => {
  const now = new Date("2026-09-07T12:00:00.000Z");
  const boundAt = new Date("2026-09-07T07:00:00.000Z");
  assert.deepEqual(
    idleBindingIds(
      [
        {
          id: 1,
          boundAt,
          lastUsedAt: null,
          fiveHourTokens: 0,
          fiveHourCredits: 0,
        },
      ],
      now,
    ),
    [1],
  );
});

test("a channel Key used in the last 5 hours stays bound", () => {
  const now = new Date("2026-09-07T12:00:00.000Z");
  const boundAt = new Date("2026-09-07T01:00:00.000Z");
  assert.deepEqual(
    idleBindingIds(
      [
        {
          id: 11,
          boundAt,
          lastUsedAt: new Date("2026-09-07T08:00:00.000Z"),
          fiveHourTokens: 0,
          fiveHourCredits: 0,
        },
        {
          id: 12,
          boundAt,
          lastUsedAt: null,
          fiveHourTokens: 100,
          fiveHourCredits: 0,
        },
        {
          id: 13,
          boundAt,
          lastUsedAt: null,
          fiveHourTokens: 0,
          fiveHourCredits: 1.5,
        },
        {
          id: 14,
          boundAt: new Date("2026-09-07T08:00:00.000Z"),
          lastUsedAt: null,
          fiveHourTokens: 0,
          fiveHourCredits: 0,
        },
      ],
      now,
    ),
    [],
  );
});

test("enterprise-scoped bindings belong to that enterprise even if the subject is elsewhere", () => {
  assert.equal(
    enterpriseIdForBindingScope({ scopeType: "enterprise", scopeId: 7 }, 99),
    7,
  );
  assert.equal(
    enterpriseIdForBindingScope({ scopeType: "department", scopeId: 8 }, 3),
    3,
  );
  assert.equal(
    enterpriseIdForBindingScope({ scopeType: "employee", scopeId: 11 }, 3),
    3,
  );
  assert.equal(
    enterpriseIdForBindingScope({ scopeType: "team", scopeId: 10 }, null),
    null,
  );
});
