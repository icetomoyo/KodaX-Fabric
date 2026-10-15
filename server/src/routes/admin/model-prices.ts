import type { FastifyInstance } from "fastify";
import { db } from "../../db/client.js";
import { providers } from "../../db/schema/index.js";
import {
  catalogModelKind,
  groupOfficialProviderCatalogs,
  isHuoshanProvider,
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

/** Client call name shown on the model list, e.g. huoshan/glm-5.3. */
export function catalogCallName(providerCode: string, model: string): string {
  if (model.includes("/")) return model;
  if (isHuoshanProvider(providerCode)) return `huoshan/${model}`;
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
