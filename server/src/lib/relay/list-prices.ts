import { clientModelUpstreamName } from "./client-model.js";

/**
 * Official postpaid list prices shown on the employee model list.
 * 输入 / 输出 / 缓存命中：元 / 百万 Tokens；缓存存储：元 / 百万 Tokens / 小时。
 */
export type ModelListPrice = {
  context: string | null;
  input: string | null;
  output: string | null;
  cacheStorage: string | null;
  cacheHit: string | null;
};

const GLM_PROVIDER_CODE = "glm";
const HUOSHAN_PROVIDER_CODE = "huoshan";

function price(
  context: string | null,
  input: string | null,
  output: string | null,
  cacheStorage: string | null,
  cacheHit: string | null,
): ModelListPrice {
  return { context, input, output, cacheStorage, cacheHit };
}

/**
 * 智谱 API 定价（https://docs.bigmodel.cn/cn/guide/start/pricing 最新模型表）。
 * 缓存存储官方为「限时免费」。
 */
const GLM_LIST_PRICES = new Map<string, ModelListPrice>([
  ["glm-5.3", price("1M", "8", "28", "限时免费", "2")],
  ["glm-5.3-flash", price("1M", "0.8", "2.8", "限时免费", "0.23")],
]);

/**
 * Volcengine Ark 后付费标价，取控制台默认在线推理档。
 * 详情页：https://console.volcengine.com/ark/region:cn-beijing/model/detail?name=<hyphen-name>
 * 长度分档取最低档（doubao-seed-2.0-mini 为 [0,32]）。
 * deepseek-v4.1-flash 控制台默认展示高峰时段。
 * Agent Plan 专属模型（glm-5.3、minimax-m3、kimi-k2.7-code）控制台无公开标价。
 * 上下文来自方舟 foundation 元数据 context_window。
 */
const HUOSHAN_LIST_PRICES = new Map<string, ModelListPrice>([
  ["doubao-seed-2.0-mini", price("256K", "0.2", "2", "0.017", "0.04")],
  ["deepseek-v4-flash", price("1M", "3", "9", "0.017", "0.1")],
  ["doubao-seed-2.1-lite", price("1M", "0.8", "2.7", "0.017", "0.16")],
  ["glm-5.3-flash", price("1M", "0.8", "2.8", null, "0.23")],
  ["doubao-seed-evolving", price("1M", "6", "30", "0.017", "1.2")],
  ["doubao-seed-2.1-pro", price("1M", "6", "30", "0.017", "1.2")],
  ["deepseek-v4.1-flash", price("1M", "2", "8", "0.017", "0.04")],
  ["deepseek-v4-pro", price("1M", "9", "27", "0.017", "0.3")],
  ["doubao-embedding-vision", price("128K", "0.7", null, null, null)],
]);

function modelPrefix(model: string): string | null {
  const normalized = model.trim().toLowerCase();
  const slash = normalized.indexOf("/");
  return slash > 0 ? normalized.slice(0, slash) : null;
}

/** RMB list price for the employee model table. */
export function listPriceFor(model: string, providerCode?: string | null): ModelListPrice | null {
  const prefix = modelPrefix(model);
  const name = clientModelUpstreamName(model);
  if (providerCode === GLM_PROVIDER_CODE || prefix === GLM_PROVIDER_CODE) {
    return GLM_LIST_PRICES.get(name) ?? null;
  }
  if (providerCode === HUOSHAN_PROVIDER_CODE || prefix === HUOSHAN_PROVIDER_CODE) {
    return HUOSHAN_LIST_PRICES.get(name) ?? null;
  }
  return null;
}
