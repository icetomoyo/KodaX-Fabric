import { clientModelUpstreamName } from "./relay/client-model.js";

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
export type CatalogModelTag = "文本" | "图片" | "视频" | "文件";

export function catalogModelTags(model: string): CatalogModelTag[] {
  const name = toCatalogModelName(clientModelUpstreamName(model));
  if (name === GLM_TEXT_CATALOG_MODEL) return ["文本"];
  if (name === GLM_MULTIMODAL_CATALOG_MODEL) return ["文本", "图片", "视频", "文件"];
  return [];
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

export function isGlmProvider(providerCode: string): boolean {
  return providerCode === GLM_PROVIDER_CODE;
}

export function isDeepseekProvider(providerCode: string): boolean {
  return providerCode === DEEPSEEK_PROVIDER_CODE;
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

export function glmProviderBlocksClientModel(providerCode: string, clientModel: string): boolean {
  return isGlmProvider(providerCode) && !isGlmClientModelAllowed(clientModel);
}

export function deepseekProviderBlocksClientModel(providerCode: string, clientModel: string): boolean {
  return isDeepseekProvider(providerCode) && !isDeepseekClientModelAllowed(clientModel);
}

export function providerBlocksClientModel(providerCode: string, clientModel: string): boolean {
  return glmProviderBlocksClientModel(providerCode, clientModel)
    || deepseekProviderBlocksClientModel(providerCode, clientModel);
}

export function isProviderClientModelAllowed(providerCode: string, model: string): boolean {
  if (isGlmProvider(providerCode)) return isGlmClientModelAllowed(model);
  if (isDeepseekProvider(providerCode)) return isDeepseekClientModelAllowed(model);
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
    if (toCatalogModelName(name) !== catalogModel) continue;
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
      const discovered = collectCatalogModels(group.metas);
      const extras = isGlmProvider(group.providerCode)
        ? GLM_CATALOG_MODELS
        : isDeepseekProvider(group.providerCode)
          ? DEEPSEEK_CATALOG_MODELS
          : [];
      const merged = extras.length > 0 && discovered.length > 0
        ? uniqueSorted([...discovered, ...extras])
        : discovered;
      const models = isGlmProvider(group.providerCode)
        ? merged.filter((model) => (GLM_CATALOG_MODELS as readonly string[]).includes(model))
        : merged;
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

