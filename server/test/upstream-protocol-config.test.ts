import assert from "node:assert/strict";
import test from "node:test";
import {
  getProviderTemplate,
  PROVIDER_TEMPLATES,
  resolveTemplateProductLineOption,
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
    ["anthropic_messages", "openai_chat", "openai_responses"],
  );
  assert.deepEqual(resolution, {
    ok: true,
    configs: {
      anthropic_messages: {
        baseUrl: "https://open.bigmodel.cn/api/anthropic",
        authStyle: "x-api-key",
      },
      openai_chat: {
        baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
        authStyle: "bearer",
      },
      openai_responses: {
        baseUrl: "https://open.bigmodel.cn/api/v1",
        authStyle: "bearer",
      },
    },
  });
});

test("GLM international template uses Z.ai coding and anthropic endpoints", () => {
  const glm = getProviderTemplate("glm")!;
  assert.equal(glm.baseUrls[1]?.productLineCode, "api_intl");
  assert.equal(
    resolveTemplateProductLineOption(glm, "api_intl")?.host,
    "api.z.ai",
  );
  // CN and INTL are distinct channels; unknown codes must not fall back.
  assert.equal(resolveTemplateProductLineOption(glm, "legacy_unknown"), undefined);
  const resolution = resolveTemplateProtocolConfigs(
    glm,
    "api_intl",
    ["anthropic_messages", "openai_chat", "openai_responses"],
  );
  assert.deepEqual(resolution, {
    ok: true,
    configs: {
      anthropic_messages: {
        baseUrl: "https://api.z.ai/api/anthropic",
        authStyle: "x-api-key",
      },
      openai_chat: {
        baseUrl: "https://api.z.ai/api/coding/paas/v4",
        authStyle: "bearer",
      },
      openai_responses: {
        baseUrl: "https://api.z.ai/api/v1",
        authStyle: "bearer",
      },
    },
  });
});

test("every provider option exposes its supported protocol configuration", () => {
  for (const template of PROVIDER_TEMPLATES) {
    for (const option of template.baseUrls) {
      for (const protocol of template.defaultProtocols) {
        assert.ok(option.protocolConfigs[protocol]);
      }
    }
  }
});

test("template product lines preserve API versus Coding Plan identity", () => {
  const glm = getProviderTemplate("glm")!;

  assert.equal(glm.baseUrls[0].productType, "coding_plan");
  assert.equal(glm.baseUrls.find((option) => option.productLineCode === "api_intl")?.productType, "coding_plan");
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
      protocol: "anthropic_messages",
      protocolConfigs: null,
      legacyBaseUrl: "https://legacy.example.test/v1/",
      legacyAuthStyle: "x-api-key",
    }),
    { baseUrl: "https://legacy.example.test/v1", authStyle: "x-api-key" },
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
