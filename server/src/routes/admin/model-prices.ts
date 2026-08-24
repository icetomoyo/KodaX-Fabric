import type { FastifyInstance } from "fastify";
import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import { modelPrices, requestAudits } from "../../db/schema/index.js";
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
});

const updatePriceSchema = z
  .object({
    model: z.string().trim().min(1).max(128).optional(),
    promptPricePerMillion: priceAmountSchema.optional(),
    completionPricePerMillion: priceAmountSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0);

function isUniqueConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("model_prices_model_uidx") || message.includes("unique");
}

function serializePrice(row: {
  id: number;
  model: string;
  promptPricePerMillion: string;
  completionPricePerMillion: string;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt?: Date | null;
}) {
  return {
    id: row.id,
    model: row.model,
    promptPricePerMillion: row.promptPricePerMillion,
    completionPricePerMillion: row.completionPricePerMillion,
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

    const [prices, unpricedModels] = await Promise.all([
      db
        .select({
          id: modelPrices.id,
          model: modelPrices.model,
          promptPricePerMillion: modelPrices.promptPricePerMillion,
          completionPricePerMillion: modelPrices.completionPricePerMillion,
          createdAt: modelPrices.createdAt,
          updatedAt: modelPrices.updatedAt,
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
        .leftJoin(modelPrices, eq(modelPrices.model, requestAudits.clientModel))
        .where(and(gte(requestAudits.createdAt, since), isNull(modelPrices.id)))
        .groupBy(requestAudits.clientModel)
        .orderBy(asc(requestAudits.clientModel)),
    ]);

    return {
      success: true,
      data: {
        prices: prices.map((row) => serializePrice(row)),
        unpricedModels: unpricedModels.map((row) => ({
          model: row.model,
          lastUsedAt: row.lastUsedAt,
          seenInLast30Days: true,
        })),
      },
    };
  });

  app.post("/api/admin/model-prices", async (req, reply) => {
    const body = createPriceSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    try {
      const [row] = await db
        .insert(modelPrices)
        .values({
          model: body.data.model,
          promptPricePerMillion: body.data.promptPricePerMillion,
          completionPricePerMillion: body.data.completionPricePerMillion,
        })
        .returning({
          id: modelPrices.id,
          model: modelPrices.model,
          promptPricePerMillion: modelPrices.promptPricePerMillion,
          completionPricePerMillion: modelPrices.completionPricePerMillion,
          createdAt: modelPrices.createdAt,
          updatedAt: modelPrices.updatedAt,
        });
      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "model_price.create",
        targetType: "model_price",
        targetId: String(row.id),
        detail: {
          model: row.model,
          promptPricePerMillion: row.promptPricePerMillion,
          completionPricePerMillion: row.completionPricePerMillion,
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
      updatedAt: Date;
    } = { updatedAt: new Date() };
    if (body.data.model !== undefined) patch.model = body.data.model;
    if (body.data.promptPricePerMillion !== undefined) {
      patch.promptPricePerMillion = body.data.promptPricePerMillion;
    }
    if (body.data.completionPricePerMillion !== undefined) {
      patch.completionPricePerMillion = body.data.completionPricePerMillion;
    }
    try {
      const [row] = await db
        .update(modelPrices)
        .set(patch)
        .where(eq(modelPrices.id, params.data.id))
        .returning({
          id: modelPrices.id,
          model: modelPrices.model,
          promptPricePerMillion: modelPrices.promptPricePerMillion,
          completionPricePerMillion: modelPrices.completionPricePerMillion,
          createdAt: modelPrices.createdAt,
          updatedAt: modelPrices.updatedAt,
        });
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
