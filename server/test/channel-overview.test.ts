import assert from "node:assert/strict";
import test from "node:test";
import type { ChannelCredentialRow } from "../src/lib/channel-overview.js";

// channel-overview imports db/client → config; unit tests only use pure summarize helpers.
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const { summarizeChannelOverview } = await import("../src/lib/channel-overview.js");

const now = new Date("2026-08-06T12:00:00.000Z");

function row(
  partial: Partial<ChannelCredentialRow> & Pick<ChannelCredentialRow, "productLineId">,
): ChannelCredentialRow {
  return {
    productLineStatus: "active",
    providerStatus: "active",
    credentialStatus: "active",
    coolUntil: null,
    weight: 100,
    ...partial,
  };
}

test("one enabled channel with four keys counts as one channel", () => {
  const stats = summarizeChannelOverview(
    [
      row({ productLineId: 1, credentialStatus: "active", weight: 100 }),
      row({ productLineId: 1, credentialStatus: "active", weight: 50 }),
      row({ productLineId: 1, credentialStatus: "cooling", coolUntil: new Date("2026-08-07T00:00:00.000Z") }),
      row({ productLineId: 1, credentialStatus: "auto_disabled", weight: 10 }),
    ],
    now,
  );
  assert.deepEqual(stats, { total: 1, enabled: 1, unavailable: 0 });
});

test("enabled channel with all keys unschedulable is unavailable", () => {
  const stats = summarizeChannelOverview(
    [
      row({ productLineId: 1, credentialStatus: "disabled", weight: 100 }),
      row({ productLineId: 1, credentialStatus: "auto_disabled", weight: 100 }),
      row({ productLineId: 1, credentialStatus: "active", weight: 0 }),
      row({
        productLineId: 1,
        credentialStatus: "cooling",
        coolUntil: new Date("2026-08-07T00:00:00.000Z"),
        weight: 100,
      }),
    ],
    now,
  );
  assert.deepEqual(stats, { total: 1, enabled: 1, unavailable: 1 });
});

test("enabled channel with no keys is unavailable", () => {
  const stats = summarizeChannelOverview(
    [row({ productLineId: 1, credentialStatus: null, coolUntil: null, weight: null })],
    now,
  );
  assert.deepEqual(stats, { total: 1, enabled: 1, unavailable: 1 });
});

test("manually disabled product line is counted only in total", () => {
  const stats = summarizeChannelOverview(
    [row({ productLineId: 1, productLineStatus: "disabled", credentialStatus: "active" })],
    now,
  );
  assert.deepEqual(stats, { total: 1, enabled: 0, unavailable: 0 });
});

test("disabled provider excludes channel from enabled and unavailable", () => {
  const stats = summarizeChannelOverview(
    [row({ productLineId: 1, providerStatus: "disabled", credentialStatus: "active" })],
    now,
  );
  assert.deepEqual(stats, { total: 1, enabled: 0, unavailable: 0 });
});

test("two channels with ten keys aggregate by product line", () => {
  const rows: ChannelCredentialRow[] = [];
  for (let i = 0; i < 6; i += 1) {
    rows.push(row({ productLineId: 1, weight: 10 + i }));
  }
  for (let i = 0; i < 4; i += 1) {
    rows.push(row({ productLineId: 2, weight: 20 + i }));
  }
  const stats = summarizeChannelOverview(rows, now);
  assert.deepEqual(stats, { total: 2, enabled: 2, unavailable: 0 });
});

test("one auto-disabled key does not mark channel unavailable when another is schedulable", () => {
  const stats = summarizeChannelOverview(
    [
      row({ productLineId: 1, credentialStatus: "auto_disabled", weight: 100 }),
      row({ productLineId: 1, credentialStatus: "active", weight: 50 }),
    ],
    now,
  );
  assert.deepEqual(stats, { total: 1, enabled: 1, unavailable: 0 });
});

test("cooling that has expired is treated as active when weight > 0", () => {
  const stats = summarizeChannelOverview(
    [
      row({
        productLineId: 1,
        credentialStatus: "cooling",
        coolUntil: new Date("2026-08-06T11:00:00.000Z"),
        weight: 100,
      }),
    ],
    now,
  );
  assert.deepEqual(stats, { total: 1, enabled: 1, unavailable: 0 });
});
