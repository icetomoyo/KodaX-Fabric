import type { FastifyInstance } from "fastify";
import { db } from "../../db/client.js";
import { providers } from "../../db/schema/index.js";
import { findChannelPlugin } from "../../channels/index.js";
import {
  catalogModelKind,
  groupOfficialProviderCatalogs,
  type CatalogModelKind,
} from "../../lib/discovered-models.js";
import { creditRateFor, type ModelCreditRate } from "../../lib/relay/credit-cost.js";
import {
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

export async function adminModelPriceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requireRoles("admin"));

  app.get("/api/admin/model-prices", async () => {
    const providerRows = await db
      .select({
        id: providers.id,
        code: providers.code,
        name: providers.name,
      })
      .from(providers);

    const channels = groupOfficialProviderCatalogs(providerRows).map((channel) => ({
      ...channel,
      models: channel.models.map((model) =>
        toCatalogModelEntry(catalogCallName(channel.providerCode, model), channel.providerCode),
      ),
    }));

    return {
      success: true,
      data: { channels },
    };
  });
}

export type CatalogModelEntry = {
  model: string;
  kind: CatalogModelKind;
  creditRate: ModelCreditRate | null;
};

/** Client call name shown on the model list: bare for alias channels, otherwise `channel/model`. */
export function catalogCallName(providerCode: string, model: string): string {
  if (model.includes("/")) return model;
  const plugin = findChannelPlugin(providerCode);
  if (plugin && !plugin.models.bareAlias) return `${plugin.code}/${model}`;
  return model;
}

export function toCatalogModelEntry(
  model: string,
  providerCode?: string | null,
): CatalogModelEntry {
  return {
    model,
    kind: catalogModelKind(model, providerCode),
    creditRate: creditRateFor(model, providerCode),
  };
}
