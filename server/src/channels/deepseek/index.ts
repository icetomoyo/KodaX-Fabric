import type { ProductLineProtocolConfigs } from "../../lib/upstream-protocol-config.js";
import type { ChannelPlugin } from "../types.js";
import { classifyDeepseekError } from "./error-codes.js";

const FLASH_MODEL = "deepseek-flash";

const PROTOCOL_CONFIGS: ProductLineProtocolConfigs = {
  anthropic_messages: {
    baseUrl: "https://api.deepseek.com/anthropic",
    authStyle: "x-api-key",
  },
  openai_chat: {
    baseUrl: "https://api.deepseek.com",
    authStyle: "bearer",
  },
  openai_responses: {
    baseUrl: "https://api.deepseek.com",
    authStyle: "bearer",
  },
};

function toCatalogName(upstream: string): string | null {
  return upstream.trim().toLowerCase().startsWith("deepseek") ? FLASH_MODEL : null;
}

export const deepseekChannel: ChannelPlugin = {
  code: "deepseek",
  meta: { title: "DeepSeek", company: "深度求索", color: "#0891b2", productLabel: "充值账户" },
  productType: "api",
  variants: [{ code: "default", label: "API", codePrefix: "ds", protocolConfigs: PROTOCOL_CONFIGS }],
  models: {
    allowlist: [FLASH_MODEL],
    testModel: "deepseek-chat",
    bareAlias: true,
    toCatalogName,
  },
  classifyError: classifyDeepseekError,
};
