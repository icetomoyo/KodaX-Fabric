import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { findChannelPlugin, listChannelPlugins, resolveChannelVariant } from "../src/channels/index.js";
import { planUpstreamChannelCreate } from "../src/lib/upstream-channel-create.js";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

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

test("GLM create plan always records a coding-plan package", () => {
  const plan = planUpstreamChannelCreate({
    ...domesticConfigs,
    productType: "api",
    seatCount: 0,
  });
  assert.equal(plan.kind, "accepted");
  if (plan.kind !== "accepted") return;
  assert.equal(plan.productType, "coding_plan");
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

test("Huoshan Agent Plan create plan copies official Ark plan endpoints", () => {
  const plan = planUpstreamChannelCreate({
    name: "Agent-Medium",
    tag: "",
    seatCount: 20,
    status: "active",
    supportedProtocols: ["anthropic_messages", "openai_chat", "openai_responses"],
    provider: "huoshan",
  });
  assert.equal(plan.kind, "accepted");
  if (plan.kind !== "accepted") return;
  assert.equal(plan.providerCode, "huoshan");
  assert.equal(plan.providerName, "火山方舟");
  assert.equal(plan.productType, "coding_plan");
  assert.equal(plan.protocolConfigs.openai_chat?.baseUrl, "https://ark.cn-beijing.volces.com/api/plan/v3");
  assert.equal(plan.protocolConfigs.anthropic_messages?.baseUrl, "https://ark.cn-beijing.volces.com/api/plan");
  assert.equal(plan.protocolConfigs.openai_responses?.baseUrl, "https://ark.cn-beijing.volces.com/api/plan/v3");
  assert.match(plan.allocateCode(), /^hs_[0-9a-f]{16}$/);

  const apiPlan = planUpstreamChannelCreate({
    name: "后付费",
    tag: "",
    seatCount: 0,
    status: "active",
    supportedProtocols: ["openai_chat"],
    provider: "huoshan",
    productType: "api",
  });
  assert.equal(apiPlan.kind, "accepted");
  if (apiPlan.kind !== "accepted") return;
  assert.equal(apiPlan.productType, "coding_plan");
});

test("create plan rejects the removed self-hosted providers", () => {
  assert.equal(
    planUpstreamChannelCreate({ ...domesticConfigs, provider: "haizhi" }).kind,
    "provider_unsupported",
  );
  assert.equal(
    planUpstreamChannelCreate({ ...domesticConfigs, provider: "custom" }).kind,
    "provider_unsupported",
  );
});

// testModel 失败方式（先于实现编写）：
// 1. 缺省 / 空串 / 纯空白 → 接受，testModel 落为 null（走 discoveredModels/内置默认兜底）。
// 2. 带前后空白的合法值 → trim 后进 plan。
// 3. 超过 128 字符 → 拒绝（test_model_invalid）。
// 4. 非字符串（数字、对象）→ 拒绝。
test("create plan accepts an optional per-channel test model", () => {
  const omitted = planUpstreamChannelCreate(domesticConfigs);
  assert.equal(omitted.kind, "accepted");
  if (omitted.kind !== "accepted") return;
  assert.equal(omitted.testModel, null);

  const blank = planUpstreamChannelCreate({ ...domesticConfigs, testModel: "   " });
  assert.equal(blank.kind, "accepted");
  if (blank.kind !== "accepted") return;
  assert.equal(blank.testModel, null);

  const trimmed = planUpstreamChannelCreate({ ...domesticConfigs, testModel: "  glm-4.5-air  " });
  assert.equal(trimmed.kind, "accepted");
  if (trimmed.kind !== "accepted") return;
  assert.equal(trimmed.testModel, "glm-4.5-air");

  const oversized = planUpstreamChannelCreate({ ...domesticConfigs, testModel: "m".repeat(129) });
  assert.equal(oversized.kind, "test_model_invalid");

  const wrongType = planUpstreamChannelCreate({ ...domesticConfigs, testModel: 42 });
  assert.equal(wrongType.kind, "test_model_invalid");
});

test("GLM create plan rejects the old custom line", () => {
  const plan = planUpstreamChannelCreate({
    ...domesticConfigs,
    variant: "custom",
  });
  assert.equal(plan.kind, "provider_unsupported");
});

test("create plan treats an empty request body as name_required", () => {
  assert.equal(planUpstreamChannelCreate({}).kind, "name_required");
  assert.equal(planUpstreamChannelCreate(undefined).kind, "name_required");
});

test("stored GLM channels with unique codes still resolve to 国内版 or 国际版 by URL", () => {
  const plugin = findChannelPlugin("glm");
  assert.ok(plugin);
  const domestic = resolveChannelVariant(
    plugin,
    { openai_chat: { baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4", authStyle: "bearer" } },
  );
  assert.equal(domestic.label, "国内版");
  const intl = resolveChannelVariant(
    plugin,
    { openai_chat: { baseUrl: "https://api.z.ai/api/coding/paas/v4", authStyle: "bearer" } },
  );
  assert.equal(intl.label, "国际版");
});

test("GET /api/admin/channel-types lists the three channel plugins", async () => {
  const { adminProviderRoutes } = await import("../src/routes/admin/providers.js");
  const app = Fastify();
  app.addHook("onRequest", async (req: { session?: { role: string }; employeeId?: number }) => {
    req.session = {
      sub: "1",
      role: "admin",
      phone: "13800000001",
      name: "Admin",
      mustChangePassword: false,
      enterpriseId: null,
    } as never;
    req.employeeId = 1;
  });
  await app.register(adminProviderRoutes);
  await app.ready();
  try {
    const response = await app.inject({ method: "GET", url: "/api/admin/channel-types" });
    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      success: boolean;
      data: Array<{
        code: string;
        title: string;
        company: string;
        productType: string;
        models: { allowlist: string[]; testModel: string };
      }>;
    };
    assert.equal(body.success, true);
    assert.deepEqual(
      body.data.map((row) => ({ code: row.code, productType: row.productType })),
      listChannelPlugins().map((plugin) => ({
        code: plugin.code,
        productType: plugin.productType,
      })),
    );
    assert.equal(body.data[0]?.models.testModel, "glm-5.3");
    assert.equal(body.data[1]?.models.testModel, "deepseek-chat");
    assert.equal(body.data[2]?.models.testModel, "doubao-seed-2.0-mini");
  } finally {
    await app.close();
  }
});
