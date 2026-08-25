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
