import type { FastifyInstance } from "fastify";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import {
  modelPrices,
  productLines,
  providers,
  requestAudits,
  upstreamCredentials,
} from "../../db/schema/index.js";
import {
  collectDiscoveredModels,
  groupDiscoveredModelsByChannel,
} from "../../lib/discovered-models.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import { addCalendarDays, quotaDayAt, zonedDayStart } from "../../lib/quota-time.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

const PRICE_PATTERN = /^(?:0|[1-9]\d{0,7})(?:\.\d{1,4})?$/;

const priceAmountSchema = z
  .union([z.number().nonnegative().finite(), z.string().trim().min(1)])
  .superRefine((value, ctx) => {
    const raw = typeof value === "number" ? value.toString() : value;
    if (!PRICE_PATTERN.test(raw)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid price" });
    }
  })
  .transform((value) => (typeof value === "number" ? value.toString() : value.trim()));

const createPriceSchema = z.object({
  model: z.string().trim().min(1).max(128),
  promptPricePerMillion: priceAmountSchema,
  completionPricePerMillion: priceAmountSchema,
  cacheHitPricePerMillion: priceAmountSchema,
  cacheStoragePricePerMillionPerHour: priceAmountSchema,
});

const updatePriceSchema = z
  .object({
    model: z.string().trim().min(1).max(128).optional(),
    promptPricePerMillion: priceAmountSchema.optional(),
    completionPricePerMillion: priceAmountSchema.optional(),
    cacheHitPricePerMillion: priceAmountSchema.optional(),
    cacheStoragePricePerMillionPerHour: priceAmountSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0);

function isUniqueConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("model_prices_model_uidx") || message.includes("unique");
}

const priceReturning = {
  id: modelPrices.id,
  model: modelPrices.model,
  promptPricePerMillion: modelPrices.promptPricePerMillion,
  completionPricePerMillion: modelPrices.completionPricePerMillion,
  cacheHitPricePerMillion: modelPrices.cacheHitPricePerMillion,
  cacheStoragePricePerMillionPerHour: modelPrices.cacheStoragePricePerMillionPerHour,
  createdAt: modelPrices.createdAt,
  updatedAt: modelPrices.updatedAt,
};

function serializePrice(row: {
  id: number;
  model: string;
  promptPricePerMillion: string;
  completionPricePerMillion: string;
  cacheHitPricePerMillion: string;
  cacheStoragePricePerMillionPerHour: string;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt?: Date | null;
}) {
  return {
    id: row.id,
    model: row.model,
    promptPricePerMillion: row.promptPricePerMillion,
    completionPricePerMillion: row.completionPricePerMillion,
    cacheHitPricePerMillion: row.cacheHitPricePerMillion,
    cacheStoragePricePerMillionPerHour: row.cacheStoragePricePerMillionPerHour,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastUsedAt: row.lastUsedAt ?? null,
    seenInLast30Days: row.lastUsedAt != null,
  };
}

export async function adminModelPriceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin"));

  app.get("/api/admin/model-prices", async () => {
    const today = quotaDayAt(new Date(), env.QUOTA_TIMEZONE);
    const since = zonedDayStart(addCalendarDays(today, -29), env.QUOTA_TIMEZONE);
    const lastUsedAt = sql<Date | null>`max(${requestAudits.createdAt})`;

    const [prices, usedModels, channelRows] = await Promise.all([
      db
        .select({
          ...priceReturning,
          lastUsedAt,
        })
        .from(modelPrices)
        .leftJoin(
          requestAudits,
          and(
            eq(requestAudits.clientModel, modelPrices.model),
            gte(requestAudits.createdAt, since),
          ),
        )
        .groupBy(
          modelPrices.id,
          modelPrices.model,
          modelPrices.promptPricePerMillion,
          modelPrices.completionPricePerMillion,
          modelPrices.cacheHitPricePerMillion,
          modelPrices.cacheStoragePricePerMillionPerHour,
          modelPrices.createdAt,
          modelPrices.updatedAt,
        )
        .orderBy(asc(modelPrices.model)),
      db
        .select({
          model: requestAudits.clientModel,
          lastUsedAt,
        })
        .from(requestAudits)
        .where(gte(requestAudits.createdAt, since))
        .groupBy(requestAudits.clientModel)
        .orderBy(asc(requestAudits.clientModel)),
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

    const pricedNames = new Set(prices.map((row) => row.model));
    const usedByName = new Map(usedModels.map((row) => [row.model, row.lastUsedAt]));
    const channels = groupDiscoveredModelsByChannel(channelRows).map((channel) => ({
      ...channel,
      unpricedCount: channel.models.filter((model) => !pricedNames.has(model)).length,
      models: channel.models.map((model) => ({
        model,
        lastUsedAt: usedByName.get(model) ?? null,
        seenInLast30Days: usedByName.has(model),
      })),
    }));

    return {
      success: true,
      data: {
        prices: prices.map((row) => serializePrice(row)),
        channels,
      },
    };
  });

  app.post("/api/admin/model-prices", async (req, reply) => {
    const body = createPriceSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const credentialMetas = await db.select({ meta: upstreamCredentials.meta }).from(upstreamCredentials);
    const discoveredModels = collectDiscoveredModels(credentialMetas.map((row) => row.meta));
    if (!discoveredModels.includes(body.data.model)) {
      return reply.code(400).send({ success: false, message: "只能为渠道已发现的模型定价" });
    }
    try {
      const [row] = await db
        .insert(modelPrices)
        .values({
          model: body.data.model,
          promptPricePerMillion: body.data.promptPricePerMillion,
          completionPricePerMillion: body.data.completionPricePerMillion,
          cacheHitPricePerMillion: body.data.cacheHitPricePerMillion,
          cacheStoragePricePerMillionPerHour: body.data.cacheStoragePricePerMillionPerHour,
        })
        .returning(priceReturning);
      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "model_price.create",
        targetType: "model_price",
        targetId: String(row.id),
        detail: {
          model: row.model,
          promptPricePerMillion: row.promptPricePerMillion,
          completionPricePerMillion: row.completionPricePerMillion,
          cacheHitPricePerMillion: row.cacheHitPricePerMillion,
          cacheStoragePricePerMillionPerHour: row.cacheStoragePricePerMillionPerHour,
        },
        ip: req.ip,
      });
      return { success: true, data: serializePrice(row) };
    } catch (error) {
      if (isUniqueConflict(error)) {
        return reply.code(409).send({ success: false, message: "该模型已定价" });
      }
      throw error;
    }
  });

  app.patch("/api/admin/model-prices/:id", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    const body = updatePriceSchema.safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const patch: {
      model?: string;
      promptPricePerMillion?: string;
      completionPricePerMillion?: string;
      cacheHitPricePerMillion?: string;
      cacheStoragePricePerMillionPerHour?: string;
      updatedAt: Date;
    } = { updatedAt: new Date() };
    if (body.data.model !== undefined) patch.model = body.data.model;
    if (body.data.promptPricePerMillion !== undefined) {
      patch.promptPricePerMillion = body.data.promptPricePerMillion;
    }
    if (body.data.completionPricePerMillion !== undefined) {
      patch.completionPricePerMillion = body.data.completionPricePerMillion;
    }
    if (body.data.cacheHitPricePerMillion !== undefined) {
      patch.cacheHitPricePerMillion = body.data.cacheHitPricePerMillion;
    }
    if (body.data.cacheStoragePricePerMillionPerHour !== undefined) {
      patch.cacheStoragePricePerMillionPerHour = body.data.cacheStoragePricePerMillionPerHour;
    }
    try {
      const [row] = await db
        .update(modelPrices)
        .set(patch)
        .where(eq(modelPrices.id, params.data.id))
        .returning(priceReturning);
      if (!row) {
        return reply.code(404).send({ success: false, message: "单价不存在" });
      }
      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "model_price.update",
        targetType: "model_price",
        targetId: String(row.id),
        detail: {
          fields: Object.keys(body.data),
          model: row.model,
          promptPricePerMillion: row.promptPricePerMillion,
          completionPricePerMillion: row.completionPricePerMillion,
          cacheHitPricePerMillion: row.cacheHitPricePerMillion,
          cacheStoragePricePerMillionPerHour: row.cacheStoragePricePerMillionPerHour,
        },
        ip: req.ip,
      });
      return { success: true, data: serializePrice(row) };
    } catch (error) {
      if (isUniqueConflict(error)) {
        return reply.code(409).send({ success: false, message: "该模型已定价" });
      }
      throw error;
    }
  });

  app.delete("/api/admin/model-prices/:id", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const [row] = await db
      .delete(modelPrices)
      .where(eq(modelPrices.id, params.data.id))
      .returning({ id: modelPrices.id, model: modelPrices.model });
    if (!row) {
      return reply.code(404).send({ success: false, message: "单价不存在" });
    }
    await writeOpsAudit({
      actorEmployeeId: req.employeeId,
      action: "model_price.delete",
      targetType: "model_price",
      targetId: String(row.id),
      detail: { model: row.model },
      ip: req.ip,
    });
    return { success: true };
  });
}
