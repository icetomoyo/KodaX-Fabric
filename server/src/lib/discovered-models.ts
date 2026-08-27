function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
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
      models: collectDiscoveredModels(group.metas),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}
