export type ProviderTemplateCode = "glm" | "kimi" | "deepseek" | "minimax";

export type ProviderBaseUrlOption = {
  label: string;
  url: string;
  host: string;
  productLineCode: string;
  productLineName: string;
};

export type ProviderTemplate = {
  code: ProviderTemplateCode;
  name: string;
  shortName: string;
  description: string;
  baseUrls: ProviderBaseUrlOption[];
  defaultLabel: string;
  color: string;
};

/**
 * 当前已确认可接入的 OpenAI-compatible 官方供应商。
 * 只在管理员主动选择模板时创建实际 provider/product_line 数据。
 */
export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    code: "glm",
    name: "智谱 GLM",
    shortName: "GLM",
    description: "智谱开放平台 API，Bearer 鉴权，兼容 Chat Completions。",
    baseUrls: [
      {
        label: "中国区",
        url: "https://open.bigmodel.cn/api/paas/v4",
        host: "open.bigmodel.cn",
        productLineCode: "api",
        productLineName: "API",
      },
    ],
    defaultLabel: "GLM 主凭证",
    color: "#2563eb",
  },
  {
    code: "kimi",
    name: "Kimi / Moonshot",
    shortName: "Kimi",
    description: "Kimi 开放平台 API，兼容 OpenAI Chat Completions。",
    baseUrls: [
      {
        label: "中国区",
        url: "https://api.moonshot.cn/v1",
        host: "api.moonshot.cn",
        productLineCode: "api",
        productLineName: "API（中国区）",
      },
      {
        label: "国际区",
        url: "https://api.moonshot.ai/v1",
        host: "api.moonshot.ai",
        productLineCode: "api_intl",
        productLineName: "API（国际区）",
      },
    ],
    defaultLabel: "Kimi 主凭证",
    color: "#7c3aed",
  },
  {
    code: "deepseek",
    name: "DeepSeek",
    shortName: "DS",
    description: "DeepSeek 官方 API，兼容 OpenAI SDK 与 Chat Completions。",
    baseUrls: [
      {
        label: "官方",
        url: "https://api.deepseek.com",
        host: "api.deepseek.com",
        productLineCode: "api",
        productLineName: "API",
      },
    ],
    defaultLabel: "DeepSeek 主凭证",
    color: "#0891b2",
  },
  {
    code: "minimax",
    name: "MiniMax",
    shortName: "MiniMax",
    description: "MiniMax OpenAI-compatible API，支持国内与国际端点。",
    baseUrls: [
      {
        label: "中国区",
        url: "https://api.minimaxi.com/v1",
        host: "api.minimaxi.com",
        productLineCode: "api",
        productLineName: "API（中国区）",
      },
      {
        label: "国际区",
        url: "https://api.minimax.io/v1",
        host: "api.minimax.io",
        productLineCode: "api_intl",
        productLineName: "API（国际区）",
      },
    ],
    defaultLabel: "MiniMax 主凭证",
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
