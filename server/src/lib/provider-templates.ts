import type { RelayProtocol } from "./relay/protocol.js";
import type {
  ProductLineProtocolConfigs,
  ProtocolUpstreamConfig,
} from "./upstream-protocol-config.js";

export type ProviderTemplateCode = "glm";

/** Catch-all provider for administrator-defined upstreams that are not official templates. */
export const CUSTOM_PROVIDER_CODE = "custom" as const;
export const CUSTOM_PROVIDER_NAME = "自定义";

export type ProviderBaseUrlOption = {
  label: string;
  url: string;
  host: string;
  productLineCode: string;
  productLineName: string;
  productType: "api" | "coding_plan";
  protocolConfigs: ProductLineProtocolConfigs;
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
    description: "GLM Coding Plan 国内版与国际版，支持 OpenAI Chat 与 Anthropic Messages。",
    authStyle: "bearer",
    defaultProtocols: ["openai_chat", "anthropic_messages"],
    baseUrls: [
      {
        label: "国内版",
        url: "https://open.bigmodel.cn/api/coding/paas/v4",
        host: "open.bigmodel.cn",
        productLineCode: "api",
        productLineName: "GLM（国内版）",
        productType: "coding_plan",
        protocolConfigs: {
          openai_chat: {
            baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
            authStyle: "bearer",
          },
          anthropic_messages: {
            baseUrl: "https://open.bigmodel.cn/api/anthropic",
            authStyle: "x-api-key",
          },
        },
      },
      {
        label: "国际版",
        url: "https://api.z.ai/api/coding/paas/v4",
        host: "api.z.ai",
        productLineCode: "api_intl",
        productLineName: "GLM（国际版）",
        productType: "coding_plan",
        protocolConfigs: {
          openai_chat: {
            baseUrl: "https://api.z.ai/api/coding/paas/v4",
            authStyle: "bearer",
          },
          anthropic_messages: {
            baseUrl: "https://api.z.ai/api/anthropic",
            authStyle: "x-api-key",
          },
        },
      },
    ],
    defaultLabel: "智谱/GLM",
    color: "#2563eb",
  },
];

export function getProviderTemplate(code: string): ProviderTemplate | undefined {
  return PROVIDER_TEMPLATES.find((item) => item.code === code);
}

export function resolveTemplateProductLineOption(
  template: ProviderTemplate,
  productLineCode: string,
): ProviderBaseUrlOption | undefined {
  return template.baseUrls.find((item) => item.productLineCode === productLineCode);
}

export type TemplateProtocolConfigResolution =
  | { ok: true; configs: ProductLineProtocolConfigs }
  | { ok: false; reason: "product_line_unsupported"; unsupportedProtocols: RelayProtocol[] }
  | { ok: false; reason: "protocol_unsupported"; unsupportedProtocols: RelayProtocol[] };

export function resolveTemplateProtocolConfigs(
  template: ProviderTemplate,
  productLineCode: string,
  protocols: readonly RelayProtocol[],
): TemplateProtocolConfigResolution {
  const option = resolveTemplateProductLineOption(template, productLineCode);
  if (!option) {
    return {
      ok: false,
      reason: "product_line_unsupported",
      unsupportedProtocols: [...protocols],
    };
  }

  const configs: ProductLineProtocolConfigs = {};
  const unsupportedProtocols: RelayProtocol[] = [];
  for (const protocol of protocols) {
    const config = option.protocolConfigs[protocol] as ProtocolUpstreamConfig | undefined;
    if (!config) {
      unsupportedProtocols.push(protocol);
      continue;
    }
    configs[protocol] = { ...config };
  }
  return unsupportedProtocols.length > 0
    ? { ok: false, reason: "protocol_unsupported", unsupportedProtocols }
    : { ok: true, configs };
}

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function resolveTemplateBaseUrl(template: ProviderTemplate, value?: string): string | null {
  const normalized = normalizeBaseUrl(value || template.baseUrls[0].url);
  const allowed = Boolean(resolveTemplateBaseUrlOption(template, normalized));
  return allowed ? normalized : null;
}

export function resolveTemplateBaseUrlOption(
  template: ProviderTemplate,
  value?: string,
): ProviderBaseUrlOption | undefined {
  const normalized = normalizeBaseUrl(value || template.baseUrls[0].url);
  return template.baseUrls.find((item) =>
    normalizeBaseUrl(item.url) === normalized ||
    Object.values(item.protocolConfigs).some((config) =>
      config && normalizeBaseUrl(config.baseUrl) === normalized
    )
  );
}

export function isAllowedTemplateHost(template: ProviderTemplate, value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && template.baseUrls.some((item) => item.host === url.hostname);
  } catch {
    return false;
  }
}

export function isCustomProvider(code: string): boolean {
  return code === CUSTOM_PROVIDER_CODE;
}

/**
 * Official templates may only be probed at their documented HTTPS hosts.
 * Custom channels may use any http(s) URL the administrator stored.
 */
export function isTestableUpstreamUrl(providerCode: string, baseUrl: string): boolean {
  const template = getProviderTemplate(providerCode);
  if (template) return isAllowedTemplateHost(template, baseUrl);
  if (!isCustomProvider(providerCode)) return false;
  try {
    const url = new URL(baseUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
