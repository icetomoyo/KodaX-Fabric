import { listChannelPlugins } from "../../channels/index.js";

export type CatalogClientModel = {
  prefix: string;
  providerCode: string;
  upstreamModel: string;
  canonicalId: string;
};

function buildClientModelCatalog(): CatalogClientModel[] {
  return listChannelPlugins().flatMap((plugin) => {
    const prefix = plugin.code;
    return plugin.models.allowlist.map((upstreamModel) => ({
      prefix,
      providerCode: plugin.code,
      upstreamModel,
      canonicalId: `${prefix}/${upstreamModel}`,
    }));
  });
}

export const CLIENT_MODEL_CATALOG: readonly CatalogClientModel[] = buildClientModelCatalog();

export type ParsedClientModel =
  | {
      kind: "catalog";
      prefix: string;
      providerCode: string;
      canonicalId: string;
      upstreamModel: string;
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

/** Channel implied by the model name's routing prefix. */
export function inferChannelCode(model: string): string | null {
  const parsed = parseClientModel(model);
  return parsed.kind === "legacy" ? null : parsed.providerCode;
}

export function catalogModelsForProvider(providerCode: string): CatalogClientModel[] {
  return CLIENT_MODEL_CATALOG.filter((item) => item.providerCode === providerCode);
}
