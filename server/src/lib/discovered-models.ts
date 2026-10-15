import { findChannelPlugin, listChannelPlugins, type ChannelPlugin } from "../channels/index.js";
import type { CatalogModelTag as PluginCatalogModelTag } from "../channels/types.js";
import { clientModelUpstreamName, inferChannelCode } from "./relay/client-model.js";

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

/** Official input modalities shown on the model list. FlashX is not on Coding Plan yet. */
export type CatalogModelTag = PluginCatalogModelTag;

/**
 * Channel of a model name without a known provider (billing / display only, not routing):
 * match a routing prefix, else the plugin that folds the name into its catalog.
 */
export function inferModelChannel(model: string): ChannelPlugin | undefined {
  const prefixed = findChannelPlugin(inferChannelCode(model) ?? "");
  if (prefixed) return prefixed;
  const name = clientModelUpstreamName(model);
  return listChannelPlugins().find((plugin) => plugin.models.toCatalogName?.(name) != null);
}

export function catalogModelTags(model: string, providerCode?: string | null): CatalogModelTag[] {
  const upstream = clientModelUpstreamName(model);
  const named = findChannelPlugin(providerCode ?? "");
  if (named) return [...(named.models.tags?.(upstream) ?? [])];
  const inferred = inferModelChannel(upstream);
  return [...(inferred?.models.tags?.(toCatalogModelName(upstream)) ?? [])];
}

/** 管理端模型列表的单一类型：纯文本 / 多模态 / 向量 / 排序。 */
export type CatalogModelKind = "纯文本" | "多模态" | "向量" | "排序";

const MULTIMODAL_TAGS = new Set<CatalogModelTag>(["图片", "视频", "音频", "文件"]);

export function catalogModelKind(model: string, providerCode?: string | null): CatalogModelKind {
  const upstream = clientModelUpstreamName(model);
  for (const plugin of listChannelPlugins()) {
    if (plugin.models.embeddingModels?.includes(upstream)) return "向量";
  }
  if (/(?:^|[-_/])(?:re)?rank(?:er|ing)?(?:$|[-_/])/i.test(upstream) || upstream.includes("排序")) {
    return "排序";
  }
  const tags = catalogModelTags(model, providerCode);
  if (tags.some((tag) => MULTIMODAL_TAGS.has(tag))) return "多模态";
  return "纯文本";
}

/**
 * Catalog name used on the model-price and employee model lists.
 * Plugins fold historical aliases onto current catalog entries; unknown
 * names stay as returned.
 */
export function toCatalogModelName(model: string): string {
  const raw = model.trim();
  const name = clientModelUpstreamName(raw);
  for (const plugin of listChannelPlugins()) {
    const mapped = plugin.models.toCatalogName?.(name);
    if (mapped) return mapped;
  }
  return raw;
}

/** Relay allow-list: a named channel rejects names outside its catalog. */
export function isProviderClientModelAllowed(providerCode: string, model: string): boolean {
  const plugin = findChannelPlugin(providerCode);
  if (!plugin) return true;
  return plugin.models.allowlist.includes(clientModelUpstreamName(model));
}

export function providerBlocksClientModel(providerCode: string, clientModel: string): boolean {
  const plugin = findChannelPlugin(providerCode);
  if (!plugin) return false;
  return !isProviderClientModelAllowed(providerCode, clientModel);
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

/** Discovered Key models after catalog aliases collapse. */
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
  return findChannelPlugin(providerCode)?.models.allowlist ?? [];
}

/** 模型列表左侧渠道：与「上游渠道」页同一层，不按套餐拆。 */
export function groupOfficialProviderCatalogs(
  providerRows: ReadonlyArray<{ id: number; code: string; name: string }>,
): ChannelModelGroup[] {
  const byCode = new Map(providerRows.map((row) => [row.code, row]));
  return listChannelPlugins().flatMap((plugin) => {
    const provider = byCode.get(plugin.code);
    if (!provider) return [];
    const catalog = officialCatalogModels(plugin.code);
    if (catalog.length === 0) return [];
    const name = provider.name.trim() || plugin.code;
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
