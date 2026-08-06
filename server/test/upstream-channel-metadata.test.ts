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
    protocolConfigs: null,
    productLineId: 10,
    productLineCode: "api",
    productLineName: "API",
    productType: "api",
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
      row(2, { supportedProtocols: ["anthropic_messages"] }),
      row(3, { supportedProtocols: [], credentialStatus: "cooling" }),
      row(4, { credentialStatus: "disabled" }),
      row(5, { credentialStatus: "auto_disabled" }),
      row(6, { credentialWeight: 0 }),
    ],
    new Date("2026-08-05T00:00:00.000Z"),
  );

  assert.equal(channels.length, 1);
  assert.equal(channels[0].credentialCount, 2);
  assert.deepEqual(channels[0].compatibleProtocols, ["openai_chat", "anthropic_messages"]);
});

test("explicit channel protocol configs hide drifted credential-only protocols", () => {
  const channels = collectEmployeeUpstreamChannels(
    [
      row(1, {
        supportedProtocols: ["openai_chat", "anthropic_messages"],
        protocolConfigs: {
          openai_chat: {
            baseUrl: "https://chat.example.test/v1",
            authStyle: "bearer",
          },
        },
      }),
    ],
  );

  assert.equal(channels.length, 1);
  assert.deepEqual(channels[0].compatibleProtocols, ["openai_chat"]);
});

test("non-null malformed protocol configs fail closed instead of using credential fallback", () => {
  const channels = collectEmployeeUpstreamChannels(
    [row(1, { protocolConfigs: {}, supportedProtocols: ["openai_chat"] })],
  );

  assert.deepEqual(channels, []);
});

test("channel aggregation has no employee-grant filtering", () => {
  const channels = collectEmployeeUpstreamChannels(
    [
      row(11, {
        productLineId: 20,
        productLineName: "Restricted",
        supportedProtocols: ["openai_chat"],
      }),
      row(12, {
        productLineId: 20,
        productLineName: "Restricted",
        supportedProtocols: ["anthropic_messages"],
      }),
    ],
  );

  assert.equal(channels.length, 1);
  assert.equal(channels[0].credentialCount, 2);
  assert.deepEqual(channels[0].compatibleProtocols, [
    "openai_chat",
    "anthropic_messages",
  ]);
  assert.equal("shareMode" in channels[0], false);
});

test("channels use stable provider, product-line, id ordering", () => {
  const channels = collectEmployeeUpstreamChannels(
    [
      row(1, { productLineId: 30, productLineName: "B", providerName: "A" }),
      row(2, { productLineId: 20, productLineName: "A", providerName: "B" }),
      row(3, { productLineId: 10, productLineName: "A", providerName: "A" }),
    ],
  );

  assert.deepEqual(channels.map((channel) => channel.productLineId), [10, 30, 20]);
});
