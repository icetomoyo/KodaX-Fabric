import type { ModelCreditRate } from "../../lib/relay/credit-cost.js";
import type { ProductLineProtocolConfigs } from "../../lib/upstream-protocol-config.js";
import type { CatalogModelTag, ChannelPlugin, ChannelVariant } from "../types.js";
import { classifyGlmError } from "./error-codes.js";

const TEXT_MODEL = "glm-5.3";
const FLASH_MODEL = "glm-5.3-flash";
const GLM_CODING_PLAN_MODEL = /^glm-(\d+(?:\.\d+)?)(?:-air|-turbo|-flashx?)*$/i;
const FLASH_MODALITIES: readonly CatalogModelTag[] = ["图片", "视频", "文件", "文本"];

const GLM_FLASH_CREDIT_RATE: ModelCreditRate = {
  promptCreditsPer10k: "2.3",
  cacheHitCreditsPer10k: "0.56",
  completionCreditsPer10k: "8",
};

const GLM_DEFAULT_CREDIT_RATE: ModelCreditRate = {
  promptCreditsPer10k: "6.9",
  cacheHitCreditsPer10k: "1.7",
  completionCreditsPer10k: "24",
};

const DOMESTIC_CONFIGS: ProductLineProtocolConfigs = {
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
};

const INTERNATIONAL_CONFIGS: ProductLineProtocolConfigs = {
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
};

const VARIANTS: readonly ChannelVariant[] = [
  { code: "domestic", label: "国内版", codePrefix: "cn", protocolConfigs: DOMESTIC_CONFIGS },
  { code: "international", label: "国际版", codePrefix: "in", protocolConfigs: INTERNATIONAL_CONFIGS },
];

function toCatalogName(upstream: string): string | null {
  const name = upstream.trim().toLowerCase();
  if (!GLM_CODING_PLAN_MODEL.test(name)) return null;
  if (name.includes("flash") || name.includes("turbo") || name === "glm-4.7") return FLASH_MODEL;
  return TEXT_MODEL;
}

function tags(upstream: string): readonly CatalogModelTag[] | null {
  const name = toCatalogName(upstream) ?? upstream.trim().toLowerCase();
  if (name === TEXT_MODEL) return ["文本"];
  if (name === FLASH_MODEL) return FLASH_MODALITIES;
  return null;
}

function creditRate(upstreamModel: string): ModelCreditRate | null {
  const name = upstreamModel.toLowerCase();
  if (name.startsWith("glm") && name.includes("flash")) return GLM_FLASH_CREDIT_RATE;
  if (name.startsWith("glm")) return GLM_DEFAULT_CREDIT_RATE;
  return null;
}

export const glmChannel: ChannelPlugin = {
  code: "glm",
  meta: { title: "GLM", company: "智谱", color: "#2563eb", productLabel: "套餐" },
  productType: "coding_plan",
  variants: VARIANTS,
  // International Coding Plan keys are also served through the domestic gateway.
  relayVariant: "domestic",
  models: {
    allowlist: [TEXT_MODEL, FLASH_MODEL],
    testModel: TEXT_MODEL,
    bareAlias: true,
    toCatalogName,
    tags,
  },
  creditRate,
  classifyError: classifyGlmError,
};
