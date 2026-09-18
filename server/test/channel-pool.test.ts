import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const {
  GLM_CODING_PLAN_POOL_KEY,
  isGlmCodingPlanPool,
  pooledProductLineDisplayName,
  relayPoolKeyForLine,
  resolveRelayUpstreamConfig,
} = await import("../src/lib/relay/channel-pool.js");

test("zhipu coding-plan packages share one relay pool key", () => {
  assert.equal(
    relayPoolKeyForLine({ id: 4, providerCode: "glm", productType: "coding_plan" }),
    GLM_CODING_PLAN_POOL_KEY,
  );
  assert.equal(
    relayPoolKeyForLine({ id: 5, providerCode: "glm", productType: "coding_plan" }),
    relayPoolKeyForLine({ id: 6, providerCode: "glm", productType: "coding_plan" }),
  );
  assert.equal(
    relayPoolKeyForLine({ id: 9, providerCode: "custom", productType: "api" }),
    "line:9",
  );
  assert.equal(
    relayPoolKeyForLine({ id: 4, providerCode: "glm", productType: "api" }),
    "line:4",
  );
  assert.equal(isGlmCodingPlanPool(GLM_CODING_PLAN_POOL_KEY), true);
});

test("employee-facing glm pool title is GLM, not the package name", () => {
  assert.equal(
    pooledProductLineDisplayName({
      relayPoolKey: GLM_CODING_PLAN_POOL_KEY,
      productLineName: "GLM-10【国内】",
    }),
    "GLM",
  );
  assert.equal(
    pooledProductLineDisplayName({
      relayPoolKey: "line:9",
      productLineName: "自建",
    }),
    "自建",
  );
});

test("international glm keys are sent to the domestic gateway", () => {
  const chat = resolveRelayUpstreamConfig({
    protocol: "openai_chat",
    providerCode: "glm",
    productType: "coding_plan",
    protocolConfigs: {
      openai_chat: {
        baseUrl: "https://api.z.ai/api/coding/paas/v4",
        authStyle: "bearer",
      },
    },
    legacyBaseUrl: "https://api.z.ai/api/coding/paas/v4",
    legacyAuthStyle: "bearer",
  });
  assert.equal(chat?.baseUrl, "https://open.bigmodel.cn/api/coding/paas/v4");
  assert.equal(chat?.authStyle, "bearer");

  const anthropic = resolveRelayUpstreamConfig({
    protocol: "anthropic_messages",
    providerCode: "glm",
    productType: "coding_plan",
    protocolConfigs: {
      anthropic_messages: {
        baseUrl: "https://api.z.ai/api/anthropic",
        authStyle: "x-api-key",
      },
    },
    legacyBaseUrl: "https://api.z.ai/api/anthropic",
    legacyAuthStyle: "x-api-key",
  });
  assert.equal(anthropic?.baseUrl, "https://open.bigmodel.cn/api/anthropic");
  assert.equal(anthropic?.authStyle, "x-api-key");
});

test("non-glm channels keep their stored upstream URL", () => {
  const config = resolveRelayUpstreamConfig({
    protocol: "openai_chat",
    providerCode: "custom",
    productType: "api",
    protocolConfigs: {
      openai_chat: {
        baseUrl: "https://llm.example.test/v1",
        authStyle: "bearer",
      },
    },
    legacyBaseUrl: "https://llm.example.test/v1",
    legacyAuthStyle: "bearer",
  });
  assert.equal(config?.baseUrl, "https://llm.example.test/v1");
});
