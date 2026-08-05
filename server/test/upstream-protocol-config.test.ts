import assert from "node:assert/strict";
import test from "node:test";
import {
  getProviderTemplate,
  PROVIDER_TEMPLATES,
  resolveTemplateProtocolConfigs,
} from "../src/lib/provider-templates.js";
import {
  parseProductLineProtocolConfigs,
  planEmptyChannelProtocolConfigInitialization,
  protocolConfigsEqual,
  resolveProtocolUpstreamConfig,
} from "../src/lib/upstream-protocol-config.js";

test("GLM template derives protocol-specific endpoint and authentication", () => {
  const glm = getProviderTemplate("glm")!;
  const resolution = resolveTemplateProtocolConfigs(
    glm,
    "api",
    ["openai_chat", "anthropic_messages"],
  );
  assert.deepEqual(resolution, {
    ok: true,
    configs: {
      openai_chat: {
        baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
        authStyle: "bearer",
      },
      anthropic_messages: {
        baseUrl: "https://open.bigmodel.cn/api/anthropic",
        authStyle: "x-api-key",
      },
    },
  });
});

test("every provider option exposes its supported protocol configuration", () => {
  for (const template of PROVIDER_TEMPLATES) {
    for (const option of template.baseUrls) {
      for (const protocol of template.defaultProtocols) {
        if (template.code !== "glm" && protocol === "anthropic_messages") continue;
        assert.ok(option.protocolConfigs[protocol]);
      }
    }
  }
  const deepseek = getProviderTemplate("deepseek")!;
  assert.deepEqual(
    resolveTemplateProtocolConfigs(deepseek, "api", ["anthropic_messages"]),
    {
      ok: false,
      reason: "protocol_unsupported",
      unsupportedProtocols: ["anthropic_messages"],
    },
  );
});

test("template product lines preserve API versus Coding Plan identity", () => {
  const glm = getProviderTemplate("glm")!;
  const kimi = getProviderTemplate("kimi")!;

  assert.equal(glm.baseUrls[0].productType, "coding_plan");
  assert.equal(kimi.baseUrls.find((option) => option.productLineCode === "kimi_code")?.productType, "coding_plan");
  assert.equal(kimi.baseUrls.find((option) => option.productLineCode === "api")?.productType, "api");
});

test("protocol config resolution uses explicit config and legacy fallback only for null", () => {
  const explicit = {
    openai_chat: { baseUrl: "https://chat.example.test/v1/", authStyle: "bearer" },
  };
  assert.deepEqual(
    resolveProtocolUpstreamConfig({
      protocol: "openai_chat",
      protocolConfigs: explicit,
      legacyBaseUrl: "https://legacy.example.test/v1",
      legacyAuthStyle: "x-api-key",
    }),
    { baseUrl: "https://chat.example.test/v1", authStyle: "bearer" },
  );
  assert.equal(
    resolveProtocolUpstreamConfig({
      protocol: "anthropic_messages",
      protocolConfigs: explicit,
      legacyBaseUrl: "https://legacy.example.test/v1",
      legacyAuthStyle: "x-api-key",
    }),
    null,
  );
  assert.deepEqual(
    resolveProtocolUpstreamConfig({
      protocol: "openai_responses",
      protocolConfigs: null,
      legacyBaseUrl: "https://legacy.example.test/v1/",
      legacyAuthStyle: "bearer",
    }),
    { baseUrl: "https://legacy.example.test/v1", authStyle: "bearer" },
  );
});

test("protocol config parsing rejects malformed entries and compares normalized URLs", () => {
  assert.deepEqual(
    parseProductLineProtocolConfigs({
      openai_chat: { baseUrl: "not-a-url", authStyle: "bearer" },
      anthropic_messages: {
        baseUrl: "https://messages.example.test/",
        authStyle: "x-api-key",
      },
    }),
    {
      anthropic_messages: {
        baseUrl: "https://messages.example.test",
        authStyle: "x-api-key",
      },
    },
  );
  assert.equal(
    protocolConfigsEqual(
      { openai_chat: { baseUrl: "https://example.test/v1/", authStyle: "bearer" } },
      { openai_chat: { baseUrl: "https://example.test/v1", authStyle: "bearer" } },
    ),
    true,
  );
});

test("only an empty channel can initialise or explicitly repair template protocol configs", () => {
  const target = {
    openai_chat: { baseUrl: "https://chat.example.test/v1", authStyle: "bearer" as const },
  };

  assert.deepEqual(
    planEmptyChannelProtocolConfigInitialization({
      credentialCount: 0,
      currentProtocolConfigs: null,
      targetProtocolConfigs: target,
      currentConfigVersion: 1,
      protocolsExplicitlyRequested: false,
    }),
    { shouldInitialize: true, nextConfigVersion: 2 },
  );
  assert.deepEqual(
    planEmptyChannelProtocolConfigInitialization({
      credentialCount: 0,
      currentProtocolConfigs: {
        anthropic_messages: {
          baseUrl: "https://messages.example.test",
          authStyle: "x-api-key",
        },
      },
      targetProtocolConfigs: target,
      currentConfigVersion: 4,
      protocolsExplicitlyRequested: true,
    }),
    { shouldInitialize: true, nextConfigVersion: 5 },
  );
  assert.equal(
    planEmptyChannelProtocolConfigInitialization({
      credentialCount: 0,
      currentProtocolConfigs: {
        anthropic_messages: {
          baseUrl: "https://messages.example.test",
          authStyle: "x-api-key",
        },
      },
      targetProtocolConfigs: target,
      currentConfigVersion: 4,
      protocolsExplicitlyRequested: false,
    }).shouldInitialize,
    false,
  );
  assert.equal(
    planEmptyChannelProtocolConfigInitialization({
      credentialCount: 1,
      currentProtocolConfigs: null,
      targetProtocolConfigs: target,
      currentConfigVersion: 1,
      protocolsExplicitlyRequested: true,
    }).shouldInitialize,
    false,
  );
});
