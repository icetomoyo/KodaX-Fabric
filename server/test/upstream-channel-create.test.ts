import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateDomesticProductLineCode,
  planUpstreamChannelCreate,
} from "../src/lib/upstream-channel-create.js";
import { resolveTemplateOptionForStoredChannel } from "../src/lib/provider-templates.js";
import { getProviderTemplate } from "../src/lib/provider-templates.js";

const domesticConfigs = {
  productLineId: 1,
  name: "研发专用",
  tag: "国内",
  seatCount: 40,
  status: "active",
  supportedProtocols: ["anthropic_messages", "openai_chat"],
  provider: "glm",
  variant: "domestic",
};

test("domestic GLM create plan copies official China endpoints and unique codes", () => {
  const plan = planUpstreamChannelCreate(domesticConfigs);
  assert.equal(plan.kind, "accepted");
  if (plan.kind !== "accepted") return;
  assert.equal(plan.providerCode, "glm");
  assert.equal(plan.productType, "coding_plan");
  assert.equal(plan.tag, "国内");
  assert.equal(plan.protocolConfigs.openai_chat?.baseUrl, "https://open.bigmodel.cn/api/coding/paas/v4");
  assert.equal(plan.protocolConfigs.anthropic_messages?.baseUrl, "https://open.bigmodel.cn/api/anthropic");
  assert.equal(plan.protocolConfigs.openai_responses, undefined);
  const codes = new Set(Array.from({ length: 8 }, () => plan.allocateCode()));
  assert.equal(codes.size, 8);
  for (const code of codes) assert.match(code, /^cn_[0-9a-f]{16}$/);
});

test("GLM create plan can record an API account instead of a coding-plan package", () => {
  const plan = planUpstreamChannelCreate({
    ...domesticConfigs,
    productType: "api",
    seatCount: 0,
  });
  assert.equal(plan.kind, "accepted");
  if (plan.kind !== "accepted") return;
  assert.equal(plan.productType, "api");
  assert.equal(plan.seatCount, 0);
});

test("international GLM create plan copies official z.ai endpoints", () => {
  const plan = planUpstreamChannelCreate({
    ...domesticConfigs,
    variant: "international",
    tag: "国际",
  });
  assert.equal(plan.kind, "accepted");
  if (plan.kind !== "accepted") return;
  assert.equal(plan.providerCode, "glm");
  assert.equal(plan.productType, "coding_plan");
  assert.equal(plan.protocolConfigs.openai_chat?.baseUrl, "https://api.z.ai/api/coding/paas/v4");
  assert.equal(plan.protocolConfigs.anthropic_messages?.baseUrl, "https://api.z.ai/api/anthropic");
  assert.match(plan.allocateCode(), /^in_[0-9a-f]{16}$/);
});

test("DeepSeek create plan uses official API endpoints and is always api", () => {
  const plan = planUpstreamChannelCreate({
    name: "主账号",
    tag: "",
    seatCount: 0,
    status: "active",
    supportedProtocols: ["anthropic_messages", "openai_chat", "openai_responses"],
    provider: "deepseek",
  });
  assert.equal(plan.kind, "accepted");
  if (plan.kind !== "accepted") return;
  assert.equal(plan.providerCode, "deepseek");
  assert.equal(plan.providerName, "深度求索");
  assert.equal(plan.productType, "api");
  assert.equal(plan.protocolConfigs.openai_chat?.baseUrl, "https://api.deepseek.com");
  assert.equal(plan.protocolConfigs.anthropic_messages?.baseUrl, "https://api.deepseek.com/anthropic");
  assert.equal(plan.protocolConfigs.openai_responses?.baseUrl, "https://api.deepseek.com");
  assert.match(plan.allocateCode(), /^ds_[0-9a-f]{16}$/);
});

test("haizhi self-hosted create plan requires an upstream URL and has no GLM line", () => {
  const missing = planUpstreamChannelCreate({
    ...domesticConfigs,
    provider: "haizhi",
  });
  assert.equal(missing.kind, "custom_configs_required");

  const plan = planUpstreamChannelCreate({
    ...domesticConfigs,
    provider: "haizhi",
    protocolConfigs: {
      openai_chat: { baseUrl: "http://10.10.20.10:8080/v1", authStyle: "bearer" },
      anthropic_messages: { baseUrl: "http://10.10.20.10:8080/v1", authStyle: "x-api-key" },
    },
  });
  assert.equal(plan.kind, "accepted");
  if (plan.kind !== "accepted") return;
  assert.equal(plan.providerCode, "haizhi");
  assert.equal(plan.providerName, "海致集团");
  assert.equal(plan.productType, "api");
  assert.match(plan.allocateCode(), /^hz_[0-9a-f]{16}$/);
});

test("GLM create plan rejects the old custom line", () => {
  const plan = planUpstreamChannelCreate({
    ...domesticConfigs,
    variant: "custom",
  });
  assert.equal(plan.kind, "provider_unsupported");
  assert.match(allocateDomesticProductLineCode(), /^cn_/);
});

test("create plan treats an empty request body as name_required", () => {
  assert.equal(planUpstreamChannelCreate({}).kind, "name_required");
  assert.equal(planUpstreamChannelCreate(undefined).kind, "name_required");
});

test("stored GLM channels with unique codes still resolve to 国内版 or 国际版 by URL", () => {
  const template = getProviderTemplate("glm");
  assert.ok(template);
  const domestic = resolveTemplateOptionForStoredChannel(
    template,
    "cn_abcd",
    { openai_chat: { baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4", authStyle: "bearer" } },
  );
  assert.equal(domestic?.label, "国内版");
  const intl = resolveTemplateOptionForStoredChannel(
    template,
    "cn_efgh",
    { openai_chat: { baseUrl: "https://api.z.ai/api/coding/paas/v4", authStyle: "bearer" } },
  );
  assert.equal(intl?.label, "国际版");
});

test("deleting a channel requires a session", async () => {
  process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
  process.env.JWT_SECRET ??= "unit-test-jwt-secret";
  process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";
  const Fastify = (await import("fastify")).default;
  const { adminProviderRoutes } = await import("../src/routes/admin/providers.js");
  const app = Fastify();
  await app.register(adminProviderRoutes);
  const removed = await app.inject({
    method: "DELETE",
    url: "/api/admin/product-lines/1",
  });
  assert.equal(removed.statusCode, 401);
  await app.close();
});
