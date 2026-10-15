import type { ModelCreditRate } from "../lib/relay/credit-cost.js";
import type { ProductLineProtocolConfigs } from "../lib/upstream-protocol-config.js";
import type {
  UpstreamRateLimitDisposition,
  UpstreamUsageCap,
} from "../lib/upstream-error.js";

export const PRODUCT_TYPES = ["api", "coding_plan"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export type CatalogModelTag = "文本" | "图片" | "视频" | "文件" | "音频" | "向量化";

/** One upstream endpoint set a product can be created against (e.g. GLM 国内版 / 国际版). */
export type ChannelVariant = {
  code: string;
  label: string;
  /** Prefix of generated product codes, e.g. `cn` -> `cn_1a2b...`. */
  codePrefix: string;
  protocolConfigs: ProductLineProtocolConfigs;
};

export type CooldownDecision = {
  rateLimitDisposition: UpstreamRateLimitDisposition;
  usageCap: UpstreamUsageCap | null;
};

export type ChannelModels = {
  allowlist: readonly string[];
  testModel: string;
  /** Also accept the unprefixed name (`glm-5.3`) as an alias of `glm/glm-5.3`. */
  bareAlias?: boolean;
  embeddingModels?: readonly string[];
  /** Fold historical names onto the current catalog entry. */
  toCatalogName?(upstream: string): string | null;
  tags?(upstream: string): readonly CatalogModelTag[] | null;
};

/**
 * A channel plugin only describes how one vendor differs from the core.
 * The channel code is also its model prefix and its KEY pool key.
 */
export type ChannelPlugin = {
  code: string;
  meta: {
    title: string;
    company: string;
    color: string;
    /** Display name of a product under this channel, e.g. 套餐 / 充值账户. */
    productLabel: string;
  };
  productType: ProductType;
  /** The first variant is the default when the create request names none. */
  variants: readonly ChannelVariant[];
  /** Relay always uses this variant's endpoints, ignoring the product's stored ones. */
  relayVariant?: string;
  models: ChannelModels;
  creditRate?(upstreamModel: string): ModelCreditRate | null;
  /** Called for upstream 402 / 429 / 5xx with this channel's own error codes. */
  classifyError?(status: number, body: string): CooldownDecision | null;
};
