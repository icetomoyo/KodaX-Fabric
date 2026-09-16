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
  pickStandardShareSlot,
  resolveBindingScope,
  resolveBindingScopeFromPeak,
  unusedBindingIds,
  STANDARD_SHARE_CAPACITY,
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

test("standard with an enterprise shares an enterprise Key", () => {
  assert.deepEqual(
    resolveBindingScope({
      employeeId: 11,
      usageTier: "standard",
      teamId: 22,
      departmentId: 44,
      enterpriseId: 33,
    }),
    { scopeType: "enterprise", scopeId: 33 },
  );
});

test("standard without a department still shares the enterprise Key", () => {
  assert.deepEqual(
    resolveBindingScope({
      employeeId: 11,
      usageTier: "standard",
      teamId: 22,
      departmentId: null,
      enterpriseId: 33,
    }),
    { scopeType: "enterprise", scopeId: 33 },
  );
});

test("20 standard employees pack onto 4 Keys of 5", () => {
  assert.equal(STANDARD_SHARE_CAPACITY, 5);
  const shards: { id: number; memberCount: number }[] = [];
  let nextId = 1;
  for (let i = 0; i < 20; i += 1) {
    const slot = pickStandardShareSlot(shards);
    if (slot == null) {
      shards.push({ id: nextId, memberCount: 1 });
      nextId += 1;
    } else {
      const shard = shards.find((row) => row.id === slot);
      assert.ok(shard);
      shard.memberCount += 1;
    }
  }
  assert.equal(shards.length, 4);
  assert.deepEqual(
    shards.map((row) => row.memberCount),
    [5, 5, 5, 5],
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

test("quiet usage shares the enterprise Key", () => {
  for (const average of [1, 699_847]) {
    assert.deepEqual(
      resolveBindingScopeFromPeak({
        employeeId: 29,
        averageDailyTokens: average,
        teamId: 4,
        departmentId: 8,
        enterpriseId: 2,
      }),
      { scopeType: "enterprise", scopeId: 2 },
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

test("an idle user does not keep an exclusive or enterprise Key", () => {
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
  assert.equal(
    bindingStillNeeded(
      { scopeType: "enterprise", scopeId: 2, memberEmployeeIds: [1] },
      people,
    ),
    false,
  );
  assert.deepEqual(
    unusedBindingIds(
      [
        { id: 1, scopeType: "employee", scopeId: 1 },
        { id: 2, scopeType: "enterprise", scopeId: 2, memberEmployeeIds: [1] },
      ],
      people,
    ),
    [1, 2],
  );
});

test("low usage still shares the enterprise Key", () => {
  assert.deepEqual(
    resolveBindingScopeFromPeak({
      employeeId: 29,
      averageDailyTokens: 66_797,
      teamId: 4,
      departmentId: 8,
      enterpriseId: 2,
    }),
    { scopeType: "enterprise", scopeId: 2 },
  );
  assert.deepEqual(
    resolveBindingScope({
      employeeId: 29,
      usageTier: "standard",
      teamId: 4,
      departmentId: 8,
      enterpriseId: 2,
    }),
    { scopeType: "enterprise", scopeId: 2 },
  );
});

test("an enterprise Key with no members is unused", () => {
  const people = [
    {
      id: 1,
      usageTier: "standard" as const,
      teamId: 10,
      departmentId: 8,
      enterpriseId: 2,
    },
  ];
  assert.equal(bindingStillNeeded({ scopeType: "enterprise", scopeId: 2 }, people), false);
  assert.deepEqual(
    unusedBindingIds([{ id: 78, scopeType: "enterprise", scopeId: 2 }], people),
    [78],
  );
});

test("department leftover bindings are unused after enterprise share", () => {
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
      usageTier: "standard" as const,
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
  assert.equal(
    bindingStillNeeded(
      { scopeType: "enterprise", scopeId: 2, memberEmployeeIds: [2] },
      people,
    ),
    true,
  );
});

test("leftover team bindings are unused after enterprise share", () => {
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
  assert.equal(bindingStillNeeded({ scopeType: "department", scopeId: 8 }, people), false);
});

test("shared enterprise bindings stay when a member still resolves onto them", () => {
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
    bindingStillNeeded(
      { scopeType: "enterprise", scopeId: 2, memberEmployeeIds: [2] },
      people,
    ),
    true,
  );
  assert.equal(bindingStillNeeded({ scopeType: "department", scopeId: 8 }, people), false);
  assert.deepEqual(
    unusedBindingIds(
      [
        { id: 1, scopeType: "enterprise", scopeId: 2, memberEmployeeIds: [] },
        { id: 2, scopeType: "department", scopeId: 8 },
        { id: 3, scopeType: "enterprise", scopeId: 2, memberEmployeeIds: [2] },
      ],
      people,
    ),
    [1, 2],
  );
});

test("a bound channel Key unused for 2 hours is released", () => {
  const now = new Date("2026-09-07T12:00:00.000Z");
  assert.deepEqual(
    idleBindingIds(
      [
        {
          id: 1,
          boundAt: new Date("2026-09-07T10:00:00.000Z"),
          lastUsedAt: null,
        },
        {
          id: 2,
          boundAt: new Date("2026-09-07T01:00:00.000Z"),
          lastUsedAt: new Date("2026-09-07T10:00:00.000Z"),
        },
      ],
      now,
    ),
    [1, 2],
  );
});

test("a channel Key used in the last 2 hours stays bound", () => {
  const now = new Date("2026-09-07T12:00:00.000Z");
  const boundAt = new Date("2026-09-07T01:00:00.000Z");
  assert.deepEqual(
    idleBindingIds(
      [
        {
          id: 11,
          boundAt,
          lastUsedAt: new Date("2026-09-07T10:00:00.001Z"),
        },
        {
          id: 12,
          boundAt: new Date("2026-09-07T10:00:00.001Z"),
          lastUsedAt: null,
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
