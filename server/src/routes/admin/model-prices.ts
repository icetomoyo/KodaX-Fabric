import type { FastifyInstance } from "fastify";
import { eq, gte, sql } from "drizzle-orm";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import {
  productLines,
  providers,
  requestAudits,
  upstreamCredentials,
} from "../../db/schema/index.js";
import {
  groupDiscoveredModelsByChannel,
  lastUsedAtForCatalogModel,
} from "../../lib/discovered-models.js";
import { addCalendarDays, quotaDayAt, zonedDayStart } from "../../lib/quota-time.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

export async function adminModelPriceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin"));

  app.get("/api/admin/model-prices", async () => {
    const today = quotaDayAt(new Date(), env.QUOTA_TIMEZONE);
    const since = zonedDayStart(addCalendarDays(today, -29), env.QUOTA_TIMEZONE);
    const lastUsedAt = sql<Date | null>`max(${requestAudits.createdAt})`;

    const [usedModels, channelRows] = await Promise.all([
      db
        .select({
          model: requestAudits.clientModel,
          lastUsedAt,
        })
        .from(requestAudits)
        .where(gte(requestAudits.createdAt, since))
        .groupBy(requestAudits.clientModel)
        .orderBy(requestAudits.clientModel),
      db
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
        .leftJoin(upstreamCredentials, eq(upstreamCredentials.productLineId, productLines.id)),
    ]);

    const usedByName = new Map(usedModels.map((row) => [row.model, row.lastUsedAt]));
    const channels = groupDiscoveredModelsByChannel(channelRows).map((channel) => ({
      ...channel,
      models: channel.models.map((model) => {
        const usedAt = lastUsedAtForCatalogModel(model, usedByName);
        return {
          model,
          lastUsedAt: usedAt,
          seenInLast30Days: usedAt != null,
        };
      }),
    }));

    return {
      success: true,
      data: { channels },
    };
  });
}
