import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { productLines, providers, upstreamCredentials } from "../../db/schema/index.js";
import {
  catalogModelKind,
  groupDiscoveredModelsByChannel,
  type CatalogModelKind,
} from "../discovered-models.js";
import { getEmployeeUpstreamChannels } from "../upstream-channel-metadata.js";
import { catalogModelsForProvider } from "./client-model.js";
import { creditRateFor, type ModelCreditRate } from "./credit-cost.js";

export type EmployeeCatalogModel = {
  model: string;
  kind: CatalogModelKind;
  creditRate: ModelCreditRate | null;
};

export type EmployeeModelChannel = {
  id: number;
  name: string;
  code: string;
  providerName: string;
  providerCode: string;
  models: EmployeeCatalogModel[];
};

function catalogModelEntry(
  canonicalId: string,
  upstreamModel: string,
  providerCode: string,
): EmployeeCatalogModel {
  return {
    model: canonicalId,
    kind: catalogModelKind(upstreamModel, providerCode),
    creditRate: creditRateFor(canonicalId, providerCode),
  };
}

/**
 * Same catalog as the employee 「模型列表」 page (`GET /api/me/models`).
 * Plugin channels use the allowlist; others use models discovered on Keys.
 */
export async function listEmployeeModelChannels(
  employeeId: number,
): Promise<EmployeeModelChannel[]> {
  const accessible = await getEmployeeUpstreamChannels(employeeId);
  if (accessible.length === 0) {
    return [];
  }

  const productLineIds = [...new Set(accessible.flatMap((channel) => channel.memberProductLineIds))];
  const channelRows = await db
    .select({
      productLineId: productLines.id,
      productLineName: productLines.name,
      productLineCode: productLines.code,
      providerName: providers.name,
      providerCode: providers.code,
      meta: upstreamCredentials.meta,
    })
    .from(productLines)
    .innerJoin(providers, eq(productLines.providerId, providers.id))
    .leftJoin(
      upstreamCredentials,
      and(
        eq(upstreamCredentials.productLineId, productLines.id),
        inArray(upstreamCredentials.status, ["active", "cooling"]),
        gt(upstreamCredentials.weight, 0),
      ),
    )
    .where(inArray(productLines.id, productLineIds));

  const groupedById = new Map(
    groupDiscoveredModelsByChannel(channelRows).map((channel) => [channel.id, channel]),
  );
  return accessible.map((channel) => {
    const catalog = catalogModelsForProvider(channel.providerCode);
    const models = catalog.length > 0
      ? catalog.map((item) => catalogModelEntry(
          item.canonicalId,
          item.upstreamModel,
          channel.providerCode,
        ))
      : [...new Set(
          channel.memberProductLineIds.flatMap((id) => groupedById.get(id)?.models ?? []),
        )]
          .sort((left, right) => left.localeCompare(right))
          .map((model) => catalogModelEntry(
            `${channel.providerCode}/${model}`,
            model,
            channel.providerCode,
          ));
    return {
      id: channel.productLineId,
      name: channel.productLineName,
      code: channel.productLineCode,
      providerName: channel.providerName,
      providerCode: channel.providerCode,
      models,
    };
  });
}

/** Flat OpenAI `/v1/models` ids, same names as `/me/models`. */
export async function listEmployeeRelayModels(
  employeeId: number,
): Promise<Array<{ id: string; ownedBy: string }>> {
  const channels = await listEmployeeModelChannels(employeeId);
  const models: Array<{ id: string; ownedBy: string }> = [];
  const seen = new Set<string>();
  for (const channel of channels) {
    for (const row of channel.models) {
      if (seen.has(row.model)) continue;
      seen.add(row.model);
      models.push({ id: row.model, ownedBy: channel.providerCode });
    }
  }
  return models;
}
