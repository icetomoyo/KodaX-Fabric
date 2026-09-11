import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

test("create channel dialog is a standalone form and no longer imports keys", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const view = readFileSync(resolve(root, "web/src/views/admin/CredentialsView.vue"), "utf8");
  const fields = readFileSync(resolve(root, "web/src/views/admin/ChannelConfigFields.vue"), "utf8");
  assert.match(view, /title="新增渠道"/);
  assert.match(view, /\/api\/admin\/product-lines/);
  assert.match(view, /value="domestic">国内/);
  assert.match(view, /value="international">国际/);
  assert.doesNotMatch(view, /value="custom">自定义/);
  assert.match(view, /label="海致集团"/);
  assert.match(view, /createForm.provider === 'glm'/);
  assert.doesNotMatch(view, /新增渠道并导入 Key/);
  assert.match(fields, /标签/);
  assert.match(fields, /API 协议/);
  assert.match(fields, /席位数量/);
  assert.match(fields, /上游地址/);
  assert.doesNotMatch(fields, /协议路由/);
  assert.doesNotMatch(view, /协议路由/);
});
