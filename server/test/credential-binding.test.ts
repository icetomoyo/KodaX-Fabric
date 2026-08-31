import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const { resolveBindingScope } = await import("../src/lib/relay/binding.js");

test("heavy always binds to the employee, ignoring team and enterprise", () => {
  assert.deepEqual(
    resolveBindingScope({
      employeeId: 11,
      usageTier: "heavy",
      teamId: 22,
      enterpriseId: 33,
    }),
    { scopeType: "employee", scopeId: 11 },
  );
  assert.deepEqual(
    resolveBindingScope({
      employeeId: 11,
      usageTier: "heavy",
      teamId: null,
      enterpriseId: null,
    }),
    { scopeType: "employee", scopeId: 11 },
  );
});

test("standard with a team shares the team Key", () => {
  assert.deepEqual(
    resolveBindingScope({
      employeeId: 11,
      usageTier: "standard",
      teamId: 22,
      enterpriseId: 33,
    }),
    { scopeType: "team", scopeId: 22 },
  );
});

test("standard without a team falls back to the enterprise", () => {
  assert.deepEqual(
    resolveBindingScope({
      employeeId: 11,
      usageTier: "standard",
      teamId: null,
      enterpriseId: 33,
    }),
    { scopeType: "enterprise", scopeId: 33 },
  );
});

test("standard without a team or enterprise cannot resolve a scope", () => {
  assert.equal(
    resolveBindingScope({
      employeeId: 11,
      usageTier: "standard",
      teamId: null,
      enterpriseId: null,
    }),
    null,
  );
});

test("light shares the enterprise Key", () => {
  assert.deepEqual(
    resolveBindingScope({
      employeeId: 11,
      usageTier: "light",
      teamId: 22,
      enterpriseId: 33,
    }),
    { scopeType: "enterprise", scopeId: 33 },
  );
});

test("light without an enterprise cannot resolve a scope", () => {
  assert.equal(
    resolveBindingScope({
      employeeId: 11,
      usageTier: "light",
      teamId: 22,
      enterpriseId: null,
    }),
    null,
  );
  assert.equal(
    resolveBindingScope({
      employeeId: 11,
      usageTier: "light",
      teamId: null,
      enterpriseId: null,
    }),
    null,
  );
});
