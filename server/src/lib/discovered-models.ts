function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

/** Current Zhipu coding-plan text model; historical text names fold here. */
export const GLM_TEXT_CATALOG_MODEL = "glm-5.3";
/** Current Zhipu coding-plan multimodal model; flash / turbo / 4.7 fold here. */
export const GLM_MULTIMODAL_CATALOG_MODEL = "glm-5.3-flash";

const GLM_CODING_PLAN_MODEL = /^glm-(\d+(?:\.\d+)?)(?:-air|-turbo|-flashx?)*$/i;

/**
 * Zhipu coding-plan catalog name used on the model-price and employee
 * model lists. Text models transfer to glm-5.3; multimodal / Flash / Turbo
 * / GLM-4.7 transfer to glm-5.3-flash. OCR and other product lines stay
 * as returned. Non-GLM names are unchanged.
 */
export function toCatalogModelName(model: string): string {
  const name = model.trim().toLowerCase();
  if (!GLM_CODING_PLAN_MODEL.test(name)) return model.trim();
  if (name.includes("flash") || name.includes("turbo") || name === "glm-4.7") {
    return GLM_MULTIMODAL_CATALOG_MODEL;
  }
  return GLM_TEXT_CATALOG_MODEL;
}

const GLM_PROVIDER_CODE = "glm";

export function isGlmProvider(providerCode: string): boolean {
  return providerCode === GLM_PROVIDER_CODE;
}

/** Relay allow-list for Zhipu Keys. Other names are rejected. */
export function isGlmClientModelAllowed(model: string): boolean {
  const name = model.trim().toLowerCase();
  return name === GLM_TEXT_CATALOG_MODEL || name === GLM_MULTIMODAL_CATALOG_MODEL;
}

export function glmProviderBlocksClientModel(providerCode: string, clientModel: string): boolean {
  return isGlmProvider(providerCode) && !isGlmClientModelAllowed(clientModel);
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
    .map((group) => ({
      id: group.id,
      name: group.name,
      code: group.code,
      providerName: group.providerName,
      providerCode: group.providerCode,
      models: collectCatalogModels(group.metas),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

