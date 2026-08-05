import assert from "node:assert/strict";
import test from "node:test";
import type { UpstreamChannelCredentialMetadataRow } from "../src/lib/upstream-channel-metadata.js";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const { collectEmployeeUpstreamChannels } = await import(
  "../src/lib/upstream-channel-metadata.js"
);
const { effectiveCredentialStatus } = await import("../src/lib/credential-status.js");

function row(
  credentialId: number,
  overrides: Partial<UpstreamChannelCredentialMetadataRow> = {},
): UpstreamChannelCredentialMetadataRow {
  return {
    credentialId,
    credentialStatus: "active",
    coolUntil: null,
    credentialWeight: 100,
    supportedProtocols: ["openai_chat"],
    productLineId: 10,
    productLineCode: "api",
    productLineName: "API",
    productType: "api",
    shareMode: "public_pool",
    providerId: 1,
    providerCode: "provider",
    providerName: "Provider",
    ...overrides,
  };
}

test("effective cooling is computed without requiring a state write", () => {
  const now = new Date("2026-08-05T00:00:00.000Z");
  assert.equal(effectiveCredentialStatus("cooling", null, now), "active");
  assert.equal(
    effectiveCredentialStatus("cooling", new Date("2026-08-04T23:59:59.000Z"), now),
    "active",
  );
  assert.equal(
    effectiveCredentialStatus("cooling", new Date("2026-08-05T00:00:01.000Z"), now),
    "cooling",
  );
});

test("public channels aggregate eligible credential protocols in fixed order", () => {
  const channels = collectEmployeeUpstreamChannels(
    [
      row(1, { supportedProtocols: ["anthropic_messages", "openai_chat"] }),
      row(2, { supportedProtocols: ["openai_responses"] }),
      row(3, { supportedProtocols: [], credentialStatus: "cooling" }),
      row(4, { credentialStatus: "disabled" }),
      row(5, { credentialStatus: "auto_disabled" }),
      row(6, { credentialWeight: 0 }),
    ],
    new Set(),
    new Date("2026-08-05T00:00:00.000Z"),
  );

  assert.equal(channels.length, 1);
  assert.equal(channels[0].credentialCount, 2);
  assert.deepEqual(channels[0].compatibleProtocols, [
    "openai_chat",
    "openai_responses",
    "anthropic_messages",
  ]);
});

test("grant-only aggregation hides ungranted protocols and credential counts", () => {
  const channels = collectEmployeeUpstreamChannels(
    [
      row(11, {
        productLineId: 20,
        productLineName: "Restricted",
        shareMode: "grant_only",
        supportedProtocols: ["openai_chat"],
      }),
      row(12, {
        productLineId: 20,
        productLineName: "Restricted",
        shareMode: "grant_only",
        supportedProtocols: ["anthropic_messages"],
      }),
    ],
    new Set([11]),
  );

  assert.equal(channels.length, 1);
  assert.equal(channels[0].credentialCount, 1);
  assert.deepEqual(channels[0].compatibleProtocols, ["openai_chat"]);
});

test("channels use stable provider, product-line, id ordering", () => {
  const channels = collectEmployeeUpstreamChannels(
    [
      row(1, { productLineId: 30, productLineName: "B", providerName: "A" }),
      row(2, { productLineId: 20, productLineName: "A", providerName: "B" }),
      row(3, { productLineId: 10, productLineName: "A", providerName: "A" }),
    ],
    new Set(),
  );

  assert.deepEqual(channels.map((channel) => channel.productLineId), [10, 30, 20]);
});
