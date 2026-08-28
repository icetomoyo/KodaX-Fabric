import assert from "node:assert/strict";
import test from "node:test";
import type { CapacityCredentialRow } from "../src/lib/capacity-alert.js";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const {
  evaluateCapacityAlert,
  summarizeProductLineCapacity,
} = await import("../src/lib/capacity-alert.js");

const now = new Date("2026-08-28T04:00:00.000Z");

function row(
  partial: Partial<CapacityCredentialRow> &
    Pick<CapacityCredentialRow, "productLineId" | "productLineName">,
): CapacityCredentialRow {
  return {
    credentialStatus: "active",
    coolUntil: null,
    ...partial,
  };
}

test("cooling ratio uses effective active+cooling and skips empty pools", () => {
  const [glm, empty] = summarizeProductLineCapacity(
    [
      row({ productLineId: 1, productLineName: "GLM Coding", credentialStatus: "cooling", coolUntil: new Date("2026-08-28T05:00:00.000Z") }),
      row({ productLineId: 1, productLineName: "GLM Coding", credentialStatus: "cooling", coolUntil: new Date("2026-08-28T05:00:00.000Z") }),
      row({ productLineId: 1, productLineName: "GLM Coding", credentialStatus: "cooling", coolUntil: new Date("2026-08-28T03:00:00.000Z") }),
      row({ productLineId: 1, productLineName: "GLM Coding", credentialStatus: "active" }),
      row({ productLineId: 1, productLineName: "GLM Coding", credentialStatus: "disabled" }),
      row({ productLineId: 1, productLineName: "GLM Coding", credentialStatus: "auto_disabled" }),
      row({ productLineId: 2, productLineName: "Empty Line", credentialStatus: null }),
    ],
    now,
  );

  assert.equal(glm.coolingCount, 2);
  assert.equal(glm.poolCount, 4);
  assert.equal(glm.ratio, 0.5);
  assert.equal(empty.poolCount, 0);
  assert.equal(empty.ratio, null);
});

test("silence suppresses repeats until the window elapses", () => {
  const first = evaluateCapacityAlert({
    coolingCount: 3,
    poolCount: 10,
    threshold: 0.3,
    lastAlertAtMs: undefined,
    nowMs: 1_000,
    silenceMs: 900_000,
  });
  assert.equal(first.shouldAlert, true);
  assert.equal(first.nextLastAlertAtMs, 1_000);

  const duringSilence = evaluateCapacityAlert({
    coolingCount: 4,
    poolCount: 10,
    threshold: 0.3,
    lastAlertAtMs: first.nextLastAlertAtMs,
    nowMs: 1_000 + 60_000,
    silenceMs: 900_000,
  });
  assert.equal(duringSilence.shouldAlert, false);
  assert.equal(duringSilence.nextLastAlertAtMs, 1_000);

  const afterSilence = evaluateCapacityAlert({
    coolingCount: 4,
    poolCount: 10,
    threshold: 0.3,
    lastAlertAtMs: first.nextLastAlertAtMs,
    nowMs: 1_000 + 900_000,
    silenceMs: 900_000,
  });
  assert.equal(afterSilence.shouldAlert, true);
  assert.equal(afterSilence.nextLastAlertAtMs, 1_000 + 900_000);
});

test("recovery below threshold clears silence so the next breach alerts", () => {
  const recovered = evaluateCapacityAlert({
    coolingCount: 2,
    poolCount: 10,
    threshold: 0.3,
    lastAlertAtMs: 1_000,
    nowMs: 2_000,
    silenceMs: 900_000,
  });
  assert.equal(recovered.shouldAlert, false);
  assert.equal(recovered.nextLastAlertAtMs, undefined);

  const nextBreach = evaluateCapacityAlert({
    coolingCount: 3,
    poolCount: 10,
    threshold: 0.3,
    lastAlertAtMs: recovered.nextLastAlertAtMs,
    nowMs: 3_000,
    silenceMs: 900_000,
  });
  assert.equal(nextBreach.shouldAlert, true);
  assert.equal(nextBreach.skipped, false);
});
