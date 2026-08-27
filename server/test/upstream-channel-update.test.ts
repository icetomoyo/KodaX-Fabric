import assert from "node:assert/strict";
import test from "node:test";
import {
  collectRemovedProtocolUsage,
  planChannelProtocolUpdate,
  resolveChannelCredentialInsertProtocols,
  resolveTemplateChannelName,
  upstreamChannelUpdateSchema,
} from "../src/lib/upstream-channel-update.js";

test("channel update validation accepts the simplified editable surface", () => {
  const result = upstreamChannelUpdateSchema.safeParse({
    expectedConfigVersion: 3,
    name: "  GLM Anthropic  ",
    status: "active",
    supportedProtocols: ["anthropic_messages"],
  });

  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.name, "GLM Anthropic");
});

test("channel update validation accepts custom protocol configs", () => {
  const result = upstreamChannelUpdateSchema.safeParse({
    expectedConfigVersion: 1,
    supportedProtocols: ["openai_chat", "anthropic_messages"],
    protocolConfigs: {
      openai_chat: {
        baseUrl: "http://10.10.20.241:8078/v1",
        authStyle: "bearer",
      },
      anthropic_messages: {
        baseUrl: "http://10.10.20.241:8078/v1",
        authStyle: "x-api-key",
      },
    },
  });
  assert.equal(result.success, true);
});

test("channel update validation rejects empty, duplicate, and unknown protocol sets", () => {
  assert.equal(
    upstreamChannelUpdateSchema.safeParse({
      expectedConfigVersion: 1,
      supportedProtocols: [],
    }).success,
    false,
  );
  assert.equal(
    upstreamChannelUpdateSchema.safeParse({
      expectedConfigVersion: 1,
      supportedProtocols: ["openai_chat", "openai_chat"],
    }).success,
    false,
  );
  assert.equal(
    upstreamChannelUpdateSchema.safeParse({
      expectedConfigVersion: 1,
      supportedProtocols: ["gemini"],
    }).success,
    false,
  );
  assert.equal(
    upstreamChannelUpdateSchema.safeParse({
      expectedConfigVersion: 1,
      supportedProtocols: ["not_a_protocol"],
    }).success,
    false,
  );
  assert.equal(upstreamChannelUpdateSchema.safeParse({}).success, false);
  assert.equal(
    upstreamChannelUpdateSchema.safeParse({
      expectedConfigVersion: 1,
      baseUrlOverride: "https://example.com/api",
    }).success,
    false,
  );
  assert.equal(
    upstreamChannelUpdateSchema.safeParse({
      expectedConfigVersion: 1,
      shareMode: "grant_only",
    }).success,
    false,
  );
  assert.equal(
    upstreamChannelUpdateSchema.safeParse({
      expectedConfigVersion: 1,
      allowAutoRoute: false,
    }).success,
    false,
  );
});

test("protocol plan reports supported-protocol removals and detects credential drift", () => {
  const plan = planChannelProtocolUpdate(
    [
      { supportedProtocols: ["anthropic_messages", "openai_chat"] },
    ],
    ["openai_chat"],
  );

  assert.deepEqual(plan.currentProtocols, ["openai_chat", "anthropic_messages"]);
  assert.deepEqual(plan.nextProtocols, ["openai_chat"]);
  assert.deepEqual(plan.removedProtocols, ["anthropic_messages"]);
  assert.equal(plan.protocolsChanged, true);
});

test("protocol plan treats order-only differences as unchanged", () => {
  const plan = planChannelProtocolUpdate(
    [{ supportedProtocols: ["anthropic_messages", "openai_chat"] }],
    ["openai_chat", "anthropic_messages"],
  );

  assert.deepEqual(plan.removedProtocols, []);
  assert.equal(plan.protocolsChanged, false);
});

test("removed protocol usage only counts bindings that would be broken", () => {
  assert.deepEqual(
    collectRemovedProtocolUsage(
      [
        { protocol: "openai_chat" },
        { protocol: "anthropic_messages" },
        { protocol: "anthropic_messages" },
      ],
      ["anthropic_messages"],
    ),
    [{ protocol: "anthropic_messages", activeKeyCount: 2 }],
  );
});

test("new credentials inherit an existing channel protocol set", () => {
  assert.deepEqual(
    resolveChannelCredentialInsertProtocols(
      [{ supportedProtocols: ["anthropic_messages", "openai_chat"] }],
      ["openai_chat", "anthropic_messages"],
    ),
    {
      kind: "accepted",
      protocols: ["openai_chat", "anthropic_messages"],
    },
  );
});

test("stale credential creation cannot reintroduce channel protocol drift", () => {
  assert.deepEqual(
    resolveChannelCredentialInsertProtocols(
      [{ supportedProtocols: ["anthropic_messages"] }],
      ["openai_chat", "anthropic_messages"],
    ),
    { kind: "mismatch", channelProtocols: ["anthropic_messages"] },
  );
});

test("the first credential establishes an empty channel protocol set", () => {
  assert.deepEqual(
    resolveChannelCredentialInsertProtocols([], ["anthropic_messages"]),
    { kind: "accepted", protocols: ["anthropic_messages"] },
  );
});

test("stored channel protocols override drifted credential protocol arrays", () => {
  assert.deepEqual(
    resolveChannelCredentialInsertProtocols(
      [{ supportedProtocols: ["openai_chat"] }],
      undefined,
      ["anthropic_messages"],
    ),
    { kind: "accepted", protocols: ["anthropic_messages"] },
  );
});

test("empty channels still report removals from stored protocol configuration", () => {
  const plan = planChannelProtocolUpdate(
    [],
    ["openai_chat"],
    ["openai_chat", "anthropic_messages"],
  );
  assert.deepEqual(plan.removedProtocols, ["anthropic_messages"]);
  assert.equal(plan.protocolsChanged, true);
});

test("stored protocols and drifted credential protocols are both checked for removals", () => {
  const plan = planChannelProtocolUpdate(
    [{ supportedProtocols: ["anthropic_messages"] }],
    ["openai_chat"],
    ["openai_chat"],
  );

  assert.deepEqual(plan.currentProtocols, ["openai_chat", "anthropic_messages"]);
  assert.deepEqual(plan.nextProtocols, ["openai_chat"]);
  assert.deepEqual(plan.removedProtocols, ["anthropic_messages"]);
  assert.equal(plan.protocolsChanged, true);
});

test("template lookup preserves an administrator-edited channel name", () => {
  assert.equal(resolveTemplateChannelName("GLM Claude 专线", "GLM API"), "GLM Claude 专线");
  assert.equal(resolveTemplateChannelName(undefined, "GLM API"), "GLM API");
});
