import type { ModelCreditRate } from "../../lib/relay/credit-cost.js";
import type { ProductLineProtocolConfigs } from "../../lib/upstream-protocol-config.js";
import type { CatalogModelTag, ChannelPlugin } from "../types.js";
import { classifyHuoshanError } from "./error-codes.js";

/**
 * Volcano Ark Agent Plan (enterprise) AFP coefficients per 10k tokens.
 * Official table: https://www.volcengine.com/docs/82379/2516283
 * AFP = (input tokens × input + output tokens × output) / 10,000. Cached input
 * has no separate rate and there is no off-peak discount.
 * Hub only exposes the Agent Plan models below. GLM names stay on the Zhipu
 * channel (glm-5.3 / glm-5.3-flash / glm-latest). kimi-k2.8-preview, kimi-k3,
 * image / video / audio / Harness stay omitted.
 * Text rows use the 输入不含音频 coefficient.
 */
const TEXT_RATES: ReadonlyArray<readonly [model: string, input: string, output: string]> = [
  ["doubao-seed-2.0-mini", "0.25", "0.25"],
  ["deepseek-v4-flash", "0.5", "0.5"],
  ["doubao-seed-2.1-lite", "0.5", "0.5"],
  ["doubao-seed-evolving", "2.5", "2.5"],
  ["minimax-m3", "2.5", "2.5"],
  ["doubao-seed-2.1-pro", "2.5", "2.5"],
  ["deepseek-v4.1-flash", "2.5", "2.5"],
  ["kimi-k2.7-code", "4.5", "4.5"],
  ["deepseek-v4-pro", "5.5", "5.5"],
];

const EMBEDDING_RATES: ReadonlyArray<readonly [model: string, input: string, output: string]> = [
  ["doubao-embedding-vision", "0.5", "0.5"],
];

const CREDIT_RATES = new Map<string, ModelCreditRate>(
  [...TEXT_RATES, ...EMBEDDING_RATES].map(([model, input, output]) => [
    model,
    {
      promptCreditsPer10k: input,
      cacheHitCreditsPer10k: input,
      completionCreditsPer10k: output,
      offPeakDiscount: false,
    },
  ]),
);

const TEXT_MODELS: readonly string[] = TEXT_RATES.map(([model]) => model);
const EMBEDDING_MODELS: readonly string[] = EMBEDDING_RATES.map(([model]) => model);
const ALLOWLIST: readonly string[] = [...TEXT_MODELS, ...EMBEDDING_MODELS];

const MODALITIES: Readonly<Record<string, readonly CatalogModelTag[]>> = {
  "doubao-seed-2.0-mini": ["图片", "视频", "音频", "文本"],
  "deepseek-v4-flash": ["文本"],
  "doubao-seed-2.1-lite": ["图片", "视频", "音频", "文本"],
  "doubao-seed-evolving": ["图片", "视频", "文本"],
  "doubao-seed-2.1-pro": ["图片", "视频", "文本"],
  "deepseek-v4.1-flash": ["图片", "视频", "文本"],
  "deepseek-v4-pro": ["文本"],
  "doubao-embedding-vision": ["图片", "视频", "文本"],
};

const PROTOCOL_CONFIGS: ProductLineProtocolConfigs = {
  anthropic_messages: {
    baseUrl: "https://ark.cn-beijing.volces.com/api/plan",
    authStyle: "x-api-key",
  },
  openai_chat: {
    baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
    authStyle: "bearer",
  },
  openai_responses: {
    baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
    authStyle: "bearer",
  },
};

function tags(upstream: string): readonly CatalogModelTag[] | null {
  const listed = MODALITIES[upstream];
  if (listed) return listed;
  return ALLOWLIST.includes(upstream) ? ["文本"] : [];
}

function creditRate(upstreamModel: string): ModelCreditRate | null {
  return CREDIT_RATES.get(upstreamModel) ?? null;
}

export const huoshanChannel: ChannelPlugin = {
  code: "huoshan",
  meta: { title: "Agent Plan", company: "火山方舟", color: "#f97316", productLabel: "套餐" },
  productType: "coding_plan",
  // Plan-only base URL; the pay-as-you-go /api/v3 endpoint must not be used.
  variants: [{ code: "default", label: "Agent Plan", codePrefix: "hs", protocolConfigs: PROTOCOL_CONFIGS }],
  models: {
    allowlist: ALLOWLIST,
    testModel: "doubao-seed-2.0-mini",
    embeddingModels: EMBEDDING_MODELS,
    tags,
  },
  creditRate,
  classifyError: classifyHuoshanError,
};
