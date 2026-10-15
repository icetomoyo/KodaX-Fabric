import { clientModelUpstreamName } from "./relay/client-model.js";
import {
  HUOSHAN_ALLOWED_MODELS,
  HUOSHAN_EMBEDDING_MODELS,
} from "./relay/credit-cost.js";

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

/** Current Zhipu coding-plan text model; historical text names fold here. */
export const GLM_TEXT_CATALOG_MODEL = "glm-5.3";
/** Current Zhipu coding-plan multimodal model; flash / turbo / 4.7 / *flashx fold here. */
export const GLM_MULTIMODAL_CATALOG_MODEL = "glm-5.3-flash";

export const GLM_CATALOG_MODELS = [
  GLM_TEXT_CATALOG_MODEL,
  GLM_MULTIMODAL_CATALOG_MODEL,
] as const;

/** Official input modalities shown on the model list. FlashX is not on Coding Plan yet. */
export type CatalogModelTag = "文本" | "图片" | "视频" | "文件" | "音频" | "向量化";

/** 智谱定价表顺序：图片、视频、文件、文本。 */
const GLM_FLASH_MODALITIES: readonly CatalogModelTag[] = ["图片", "视频", "文件", "文本"];

/** 方舟 foundation `input_modalities`，展示顺序与智谱定价表一致。 */
const HUOSHAN_MODALITIES: Readonly<Record<string, readonly CatalogModelTag[]>> = {
  "doubao-seed-2.0-mini": ["图片", "视频", "音频", "文本"],
  "deepseek-v4-flash": ["文本"],
  "doubao-seed-2.1-lite": ["图片", "视频", "音频", "文本"],
  "glm-5.3-flash": ["图片", "视频", "文本"],
  "doubao-seed-evolving": ["图片", "视频", "文本"],
  "doubao-seed-2.1-pro": ["图片", "视频", "文本"],
  "deepseek-v4.1-flash": ["图片", "视频", "文本"],
  "deepseek-v4-pro": ["文本"],
  "doubao-embedding-vision": ["图片", "视频", "文本"],
};

export function catalogModelTags(model: string, providerCode?: string | null): CatalogModelTag[] {
  const upstream = clientModelUpstreamName(model);
  if (isHuoshanProvider(providerCode ?? "")) {
    const listed = HUOSHAN_MODALITIES[upstream];
    if (listed) return [...listed];
    return (HUOSHAN_ALLOWED_MODELS as readonly string[]).includes(upstream) ? ["文本"] : [];
  }
  const name = toCatalogModelName(upstream);
  if (name === GLM_TEXT_CATALOG_MODEL) return ["文本"];
  if (name === GLM_MULTIMODAL_CATALOG_MODEL) return [...GLM_FLASH_MODALITIES];
  return [];
}

/** 管理端模型列表的单一类型：纯文本 / 多模态 / 向量 / 排序。 */
export type CatalogModelKind = "纯文本" | "多模态" | "向量" | "排序";

const MULTIMODAL_TAGS = new Set<CatalogModelTag>(["图片", "视频", "音频", "文件"]);

export function catalogModelKind(model: string, providerCode?: string | null): CatalogModelKind {
  const upstream = clientModelUpstreamName(model);
  if ((HUOSHAN_EMBEDDING_MODELS as readonly string[]).includes(upstream)) return "向量";
  if (/(?:^|[-_/])(?:re)?rank(?:er|ing)?(?:$|[-_/])/i.test(upstream) || upstream.includes("排序")) {
    return "排序";
  }
  const tags = catalogModelTags(model, providerCode);
  if (tags.some((tag) => MULTIMODAL_TAGS.has(tag))) return "多模态";
  return "纯文本";
}

const GLM_CODING_PLAN_MODEL = /^glm-(\d+(?:\.\d+)?)(?:-air|-turbo|-flashx?)*$/i;

/** Current DeepSeek catalog model; other deepseek-* names fold here. */
export const DEEPSEEK_FLASH_CATALOG_MODEL = "deepseek-flash";
export const DEEPSEEK_CATALOG_MODELS = [DEEPSEEK_FLASH_CATALOG_MODEL] as const;

/**
 * Catalog name used on the model-price and employee model lists.
 * Zhipu coding-plan text transfers to glm-5.3; Flash / Turbo / GLM-4.7
 * and *flashx names transfer to glm-5.3-flash (FlashX is not on Coding Plan).
 * DeepSeek names transfer to deepseek-flash. OCR and other product lines
 * stay as returned.
 */
export function toCatalogModelName(model: string): string {
  const raw = model.trim();
  const name = clientModelUpstreamName(raw);
  if (GLM_CODING_PLAN_MODEL.test(name)) {
    if (name.includes("flash") || name.includes("turbo") || name === "glm-4.7") {
      return GLM_MULTIMODAL_CATALOG_MODEL;
    }
    return GLM_TEXT_CATALOG_MODEL;
  }
  if (name.startsWith("deepseek")) return DEEPSEEK_FLASH_CATALOG_MODEL;
  return raw;
}

const GLM_PROVIDER_CODE = "glm";
const DEEPSEEK_PROVIDER_CODE = "deepseek";
const HUOSHAN_PROVIDER_CODE = "huoshan";

export function isGlmProvider(providerCode: string): boolean {
  return providerCode === GLM_PROVIDER_CODE;
}

export function isDeepseekProvider(providerCode: string): boolean {
  return providerCode === DEEPSEEK_PROVIDER_CODE;
}

export function isHuoshanProvider(providerCode: string): boolean {
  return providerCode === HUOSHAN_PROVIDER_CODE;
}

/** Relay allow-list for Zhipu Keys. Other names are rejected. */
export function isGlmClientModelAllowed(model: string): boolean {
  const name = clientModelUpstreamName(model);
  return (GLM_CATALOG_MODELS as readonly string[]).includes(name);
}

/** Relay allow-list for DeepSeek Keys. Other names are rejected. */
export function isDeepseekClientModelAllowed(model: string): boolean {
  return clientModelUpstreamName(model) === DEEPSEEK_FLASH_CATALOG_MODEL;
}

/** Relay allow-list for Volcano Ark Agent Plan Keys. Other names are rejected. */
export function isHuoshanClientModelAllowed(model: string): boolean {
  return (HUOSHAN_ALLOWED_MODELS as readonly string[]).includes(clientModelUpstreamName(model));
}

export function glmProviderBlocksClientModel(providerCode: string, clientModel: string): boolean {
  return isGlmProvider(providerCode) && !isGlmClientModelAllowed(clientModel);
}

export function deepseekProviderBlocksClientModel(providerCode: string, clientModel: string): boolean {
  return isDeepseekProvider(providerCode) && !isDeepseekClientModelAllowed(clientModel);
}

export function huoshanProviderBlocksClientModel(providerCode: string, clientModel: string): boolean {
  return isHuoshanProvider(providerCode) && !isHuoshanClientModelAllowed(clientModel);
}

export function providerBlocksClientModel(providerCode: string, clientModel: string): boolean {
  return glmProviderBlocksClientModel(providerCode, clientModel)
    || deepseekProviderBlocksClientModel(providerCode, clientModel)
    || huoshanProviderBlocksClientModel(providerCode, clientModel);
}

export function isProviderClientModelAllowed(providerCode: string, model: string): boolean {
  if (isGlmProvider(providerCode)) return isGlmClientModelAllowed(model);
  if (isDeepseekProvider(providerCode)) return isDeepseekClientModelAllowed(model);
  if (isHuoshanProvider(providerCode)) return isHuoshanClientModelAllowed(model);
  return true;
}

function normalizeModelList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "string") return [];
    const model = item.trim();
    return model.length > 0 && model.length <= 128 ? [model] : [];
  });
}

/** Models stored after an upstream Key connectivity test. */
export function parseDiscoveredModels(meta: unknown): string[] {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return [];
  const object = meta as Record<string, unknown>;
  const fromMeta = normalizeModelList(object.discoveredModels);
  const lastTest = object.lastTest;
  const fromTest = lastTest && typeof lastTest === "object" && !Array.isArray(lastTest)
    ? normalizeModelList((lastTest as Record<string, unknown>).models)
    : [];
  return uniqueSorted([...fromMeta, ...fromTest]);
}

export function collectDiscoveredModels(metas: readonly unknown[]): string[] {
  return uniqueSorted(metas.flatMap((meta) => parseDiscoveredModels(meta)));
}

/** Discovered Key models after Zhipu coding-plan aliases collapse. */
export function collectCatalogModels(metas: readonly unknown[]): string[] {
  return uniqueSorted(collectDiscoveredModels(metas).map(toCatalogModelName));
}

export function lastUsedAtForCatalogModel(
  catalogModel: string,
  usedByName: ReadonlyMap<string, Date | null>,
): Date | null {
  let latest: Date | null = null;
  for (const [name, at] of usedByName) {
    if (!at) continue;
    const hit = name === catalogModel
      || (!catalogModel.includes("/") && toCatalogModelName(name) === catalogModel);
    if (!hit) continue;
    if (!latest || at > latest) latest = at;
  }
  return latest;
}

export type ChannelModelSource = {
  productLineId: number;
  productLineName: string;
  productLineCode: string;
  providerName: string;
  providerCode: string;
  meta: unknown;
};

export type ChannelModelGroup = {
  id: number;
  name: string;
  code: string;
  providerName: string;
  providerCode: string;
  models: string[];
};

function officialCatalogModels(providerCode: string): readonly string[] {
  if (isGlmProvider(providerCode)) return GLM_CATALOG_MODELS;
  if (isDeepseekProvider(providerCode)) return DEEPSEEK_CATALOG_MODELS;
  if (isHuoshanProvider(providerCode)) return HUOSHAN_ALLOWED_MODELS;
  return [];
}

/** 模型列表左侧渠道：智谱 / 深度求索 / 火山方舟，与「上游渠道」页同一层，不按 GLM-50 套餐拆。 */
const MODEL_PRICE_PROVIDER_ORDER = ["glm", "deepseek", "huoshan"] as const;

export function groupOfficialProviderCatalogs(
  providerRows: ReadonlyArray<{ id: number; code: string; name: string }>,
): ChannelModelGroup[] {
  const byCode = new Map(providerRows.map((row) => [row.code, row]));
  return MODEL_PRICE_PROVIDER_ORDER.flatMap((code) => {
    const provider = byCode.get(code);
    if (!provider) return [];
    const catalog = officialCatalogModels(code);
    if (catalog.length === 0) return [];
    const name = provider.name.trim() || code;
    return [{
      id: provider.id,
      name,
      code: provider.code,
      providerName: name,
      providerCode: provider.code,
      models: [...catalog],
    }];
  });
}

export function groupDiscoveredModelsByChannel(rows: ChannelModelSource[]): ChannelModelGroup[] {
  type Acc = Omit<ChannelModelGroup, "models"> & { metas: unknown[] };
  const byId = new Map<number, Acc>();
  for (const row of rows) {
    let group = byId.get(row.productLineId);
    if (!group) {
      group = {
        id: row.productLineId,
        name: row.productLineName.trim() || row.productLineCode,
        code: row.productLineCode,
        providerName: row.providerName,
        providerCode: row.providerCode,
        metas: [],
      };
      byId.set(row.productLineId, group);
    }
    if (row.meta != null) group.metas.push(row.meta);
  }
  return [...byId.values()]
    .map((group) => {
      const catalog = officialCatalogModels(group.providerCode);
      const models = catalog.length > 0
        ? [...catalog]
        : collectCatalogModels(group.metas);
      return {
        id: group.id,
        name: group.name,
        code: group.code,
        providerName: group.providerName,
        providerCode: group.providerCode,
        models,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

