export const MODEL_PREFIXES = ["glm", "deepseek", "huoshan", "haizhi"] as const;
export type ModelPrefix = (typeof MODEL_PREFIXES)[number];

export type CatalogClientModel = {
  prefix: ModelPrefix;
  providerCode: string;
  upstreamModel: string;
  canonicalId: string;
  alias: string;
};

export const CLIENT_MODEL_CATALOG: readonly CatalogClientModel[] = [
  {
    prefix: "glm",
    providerCode: "glm",
    upstreamModel: "glm-5.3",
    canonicalId: "glm/glm-5.3",
    alias: "glm-5.3",
  },
  {
    prefix: "glm",
    providerCode: "glm",
    upstreamModel: "glm-5.3-flash",
    canonicalId: "glm/glm-5.3-flash",
    alias: "glm-5.3-flash",
  },
  {
    prefix: "deepseek",
    providerCode: "deepseek",
    upstreamModel: "deepseek-flash",
    canonicalId: "deepseek/deepseek-flash",
    alias: "deepseek-flash",
  },
];

export type ParsedClientModel =
  | {
      kind: "catalog";
      prefix: ModelPrefix;
      providerCode: string;
      canonicalId: string;
      upstreamModel: string;
      fromAlias: boolean;
    }
  | {
      kind: "prefixed";
      prefix: string;
      providerCode: string;
      canonicalId: string;
      upstreamModel: string;
    }
  | {
      kind: "legacy";
      upstreamModel: string;
    };

const catalogByCanonical = new Map(
  CLIENT_MODEL_CATALOG.map((item) => [item.canonicalId, item]),
);
const catalogByAlias = new Map(
  CLIENT_MODEL_CATALOG.map((item) => [item.alias, item]),
);

function normalizeModelId(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
}

/** Upstream model name sent to the provider; strips a routing prefix if present. */
export function clientModelUpstreamName(model: string): string {
  const normalized = normalizeModelId(model);
  const slash = normalized.lastIndexOf("/");
  return slash === -1 ? normalized : normalized.slice(slash + 1);
}

export function parseClientModel(raw: string): ParsedClientModel {
  const normalized = normalizeModelId(raw);
  const catalog = catalogByCanonical.get(normalized);
  if (catalog) {
    return {
      kind: "catalog",
      prefix: catalog.prefix,
      providerCode: catalog.providerCode,
      canonicalId: catalog.canonicalId,
      upstreamModel: catalog.upstreamModel,
      fromAlias: false,
    };
  }
  const aliased = catalogByAlias.get(normalized);
  if (aliased) {
    return {
      kind: "catalog",
      prefix: aliased.prefix,
      providerCode: aliased.providerCode,
      canonicalId: aliased.canonicalId,
      upstreamModel: aliased.upstreamModel,
      fromAlias: true,
    };
  }
  const slash = normalized.indexOf("/");
  if (slash > 0) {
    const prefix = normalized.slice(0, slash);
    const upstreamModel = normalized.slice(slash + 1);
    if (prefix && upstreamModel) {
      return {
        kind: "prefixed",
        prefix,
        providerCode: prefix,
        canonicalId: `${prefix}/${upstreamModel}`,
        upstreamModel,
      };
    }
  }
  return { kind: "legacy", upstreamModel: raw.trim() };
}

export function catalogModelsForProvider(providerCode: string): CatalogClientModel[] {
  return CLIENT_MODEL_CATALOG.filter((item) => item.providerCode === providerCode);
}
