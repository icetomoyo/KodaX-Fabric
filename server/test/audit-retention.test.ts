import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const { selectStaleAuditBodyRequestIds, startAuditBodyRetention } = await import(
  "../src/lib/relay/audit-retention.js"
);

function audit(requestId: string, createdAt: string, id: number) {
  return { requestId, createdAt: new Date(createdAt), id };
}

test("retention keeps the newest K audit bodies and drops the rest", () => {
  const deleted = selectStaleAuditBodyRequestIds(
    [{ requestId: "a" }, { requestId: "b" }, { requestId: "c" }, { requestId: "orphan" }],
    [
      audit("a", "2026-08-24T10:00:00Z", 1),
      audit("b", "2026-08-24T11:00:00Z", 2),
      audit("c", "2026-08-24T12:00:00Z", 3),
    ],
    2,
  );
  assert.deepEqual(deleted.sort(), ["a", "orphan"]);
});

test("retention uses id as a tie-breaker when timestamps match", () => {
  const deleted = selectStaleAuditBodyRequestIds(
    [{ requestId: "older" }, { requestId: "newer" }],
    [
      audit("older", "2026-08-24T12:00:00Z", 10),
      audit("newer", "2026-08-24T12:00:00Z", 11),
    ],
    1,
  );
  assert.deepEqual(deleted, ["older"]);
});

test("keepLast of zero or negative disables pruning", () => {
  const bodies = [{ requestId: "a" }];
  const audits = [audit("a", "2026-08-24T10:00:00Z", 1)];
  assert.deepEqual(selectStaleAuditBodyRequestIds(bodies, audits, 0), []);
  assert.deepEqual(selectStaleAuditBodyRequestIds(bodies, audits, -1), []);
});

test("keepLast larger than the audit count deletes only orphan bodies", () => {
  const deleted = selectStaleAuditBodyRequestIds(
    [{ requestId: "kept" }, { requestId: "orphan" }],
    [audit("kept", "2026-08-24T10:00:00Z", 1)],
    50,
  );
  assert.deepEqual(deleted, ["orphan"]);
});

test("retention loop prunes immediately and can be stopped", async () => {
  let calls = 0;
  const { stop } = startAuditBodyRetention({
    keepLast: 2,
    intervalMs: 0,
    prune: async (keepLast) => {
      calls += 1;
      assert.equal(keepLast, 2);
      return 4;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  stop();
  assert.equal(calls, 1);
});

test("retention loop does not prune when keepLast is disabled", async () => {
  let calls = 0;
  const { stop } = startAuditBodyRetention({
    keepLast: 0,
    intervalMs: 0,
    prune: async () => {
      calls += 1;
      return 1;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  stop();
  assert.equal(calls, 0);
});
