import type { RelayProtocol } from "./relay/protocol.js";

export type ProviderTemplateCode =
  | "glm"
  | "kimi"
  | "deepseek"
  | "minimax";

export type ProviderBaseUrlOption = {
  label: string;
  url: string;
  host: string;
  productLineCode: string;
  productLineName: string;
};

export type ProviderTemplate = {
  code: ProviderTemplateCode;
  /** 公司名称，如「智谱」「深度求索」 */
  name: string;
  /** 模型品牌名，如「GLM」「DeepSeek」；与 name 组成「公司/模型」展示 */
  modelName: string;
  shortName: string;
  description: string;
  baseUrls: ProviderBaseUrlOption[];
  authStyle: "bearer" | "x-api-key";
  defaultProtocols: RelayProtocol[];
  defaultLabel: string;
  color: string;
};

/** 渠道展示名：公司名称/模型名称，如 智谱/GLM、深度求索/DeepSeek */
export function formatChannelName(companyName: string, modelName: string): string {
  const company = companyName.trim();
  const model = modelName.trim();
  if (!company) return model;
  if (!model) return company;
  if (company === model || model.startsWith(`${company}/`)) return model;
  return `${company}/${model}`;
}

/**
 * 当前已确认可接入的 OpenAI-compatible 官方供应商。
 * 只在管理员主动选择模板时创建实际 provider/product_line 数据。
 * 命名约定：provider.name = 公司名称，productLine.name = 模型名称。
 */
export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    code: "glm",
    name: "智谱",
    modelName: "GLM",
    shortName: "GLM",
    description: "智谱开放平台 API，Bearer 鉴权，兼容 Chat Completions。",
    authStyle: "bearer",
    defaultProtocols: ["openai_chat"],
    baseUrls: [
      {
        label: "中国区",
        url: "https://open.bigmodel.cn/api/paas/v4",
        host: "open.bigmodel.cn",
        productLineCode: "api",
        productLineName: "GLM",
      },
    ],
    defaultLabel: "智谱/GLM",
    color: "#2563eb",
  },
  {
    code: "kimi",
    name: "月之暗面",
    modelName: "Kimi",
    shortName: "Kimi",
    description: "Kimi Code 编程 API 与 Moonshot 开放平台 API，兼容 OpenAI Chat Completions。",
    authStyle: "bearer",
    defaultProtocols: ["openai_chat"],
    baseUrls: [
      {
        label: "Kimi Code",
        url: "https://api.kimi.com/coding/v1",
        host: "api.kimi.com",
        productLineCode: "kimi_code",
        productLineName: "Kimi Code",
      },
      {
        label: "中国区",
        url: "https://api.moonshot.cn/v1",
        host: "api.moonshot.cn",
        productLineCode: "api",
        productLineName: "Kimi（中国区）",
      },
      {
        label: "国际区",
        url: "https://api.moonshot.ai/v1",
        host: "api.moonshot.ai",
        productLineCode: "api_intl",
        productLineName: "Kimi（国际区）",
      },
    ],
    defaultLabel: "月之暗面/Kimi",
    color: "#7c3aed",
  },
  {
    code: "deepseek",
    name: "深度求索",
    modelName: "DeepSeek",
    shortName: "DS",
    description: "DeepSeek 官方 API，兼容 OpenAI SDK 与 Chat Completions。",
    authStyle: "bearer",
    defaultProtocols: ["openai_chat"],
    baseUrls: [
      {
        label: "官方",
        url: "https://api.deepseek.com",
        host: "api.deepseek.com",
        productLineCode: "api",
        productLineName: "DeepSeek",
      },
    ],
    defaultLabel: "深度求索/DeepSeek",
    color: "#0891b2",
  },
  {
    code: "minimax",
    name: "MiniMax",
    modelName: "MiniMax",
    shortName: "MM",
    description: "MiniMax OpenAI-compatible API，支持国内与国际端点。",
    authStyle: "bearer",
    defaultProtocols: ["openai_chat"],
    baseUrls: [
      {
        label: "中国区",
        url: "https://api.minimaxi.com/v1",
        host: "api.minimaxi.com",
        productLineCode: "api",
        productLineName: "MiniMax（中国区）",
      },
      {
        label: "国际区",
        url: "https://api.minimax.io/v1",
        host: "api.minimax.io",
        productLineCode: "api_intl",
        productLineName: "MiniMax（国际区）",
      },
    ],
    defaultLabel: "MiniMax",
    color: "#ea580c",
  },
];

export function getProviderTemplate(code: string): ProviderTemplate | undefined {
  return PROVIDER_TEMPLATES.find((item) => item.code === code);
}

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function resolveTemplateBaseUrl(template: ProviderTemplate, value?: string): string | null {
  const normalized = normalizeBaseUrl(value || template.baseUrls[0].url);
  const allowed = template.baseUrls.some((item) => normalizeBaseUrl(item.url) === normalized);
  return allowed ? normalized : null;
}

export function resolveTemplateBaseUrlOption(
  template: ProviderTemplate,
  value?: string,
): ProviderBaseUrlOption | undefined {
  const normalized = normalizeBaseUrl(value || template.baseUrls[0].url);
  return template.baseUrls.find((item) => normalizeBaseUrl(item.url) === normalized);
}

export function isAllowedTemplateHost(template: ProviderTemplate, value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && template.baseUrls.some((item) => item.host === url.hostname);
  } catch {
    return false;
  }
}
