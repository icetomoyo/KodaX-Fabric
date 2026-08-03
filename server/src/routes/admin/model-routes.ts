import type { FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { modelRoutes, productLines, providers } from "../../db/schema/index.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

export async function adminModelRouteRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin", "auditor"));

  app.get("/api/admin/model-routes", async (req) => {
    const query = z
      .object({
        clientModel: z.string().optional(),
        enabled: z
          .enum(["true", "false"])
          .optional()
          .transform((v) => (v === undefined ? undefined : v === "true")),
      })
      .parse(req.query);

    const rows = await db
      .select({
        id: modelRoutes.id,
        clientModel: modelRoutes.clientModel,
        productLineId: modelRoutes.productLineId,
        upstreamModel: modelRoutes.upstreamModel,
        enabled: modelRoutes.enabled,
        priority: modelRoutes.priority,
        weight: modelRoutes.weight,
        config: modelRoutes.config,
        createdAt: modelRoutes.createdAt,
        updatedAt: modelRoutes.updatedAt,
        productLineCode: productLines.code,
        productType: productLines.productType,
        providerCode: providers.code,
        providerName: providers.name,
      })
      .from(modelRoutes)
      .innerJoin(productLines, eq(modelRoutes.productLineId, productLines.id))
      .innerJoin(providers, eq(productLines.providerId, providers.id))
      .where(
        and(
          query.clientModel ? eq(modelRoutes.clientModel, query.clientModel) : undefined,
          query.enabled === undefined ? undefined : eq(modelRoutes.enabled, query.enabled),
        ),
      )
      .orderBy(asc(modelRoutes.clientModel), asc(modelRoutes.priority));

    return { success: true, data: rows };
  });

  app.post(
    "/api/admin/model-routes",
    { preHandler: [requireRoles("admin")] },
    async (req, reply) => {
      const body = z
        .object({
          clientModel: z.string().min(1).max(128),
          productLineId: z.number().int().positive(),
          upstreamModel: z.string().min(1).max(128),
          enabled: z.boolean().default(true),
          priority: z.number().int().default(0),
          weight: z.number().int().min(0).default(100),
          config: z.record(z.unknown()).optional(),
        })
        .safeParse(req.body);

      if (!body.success) {
        return reply.code(400).send({ success: false, message: "参数无效" });
      }

      const [row] = await db
        .insert(modelRoutes)
        .values(body.data)
        .returning();

      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "model_route.create",
        targetType: "model_route",
        targetId: String(row.id),
        detail: body.data,
        ip: req.ip,
      });

      return { success: true, data: row };
    },
  );

  app.patch(
    "/api/admin/model-routes/:id",
    { preHandler: [requireRoles("admin")] },
    async (req, reply) => {
      const params = z.object({ id: z.coerce.number() }).safeParse(req.params);
      const body = z
        .object({
          clientModel: z.string().min(1).max(128).optional(),
          productLineId: z.number().int().positive().optional(),
          upstreamModel: z.string().min(1).max(128).optional(),
          enabled: z.boolean().optional(),
          priority: z.number().int().optional(),
          weight: z.number().int().min(0).optional(),
          config: z.record(z.unknown()).nullable().optional(),
        })
        .safeParse(req.body);

      if (!params.success || !body.success) {
        return reply.code(400).send({ success: false, message: "参数无效" });
      }

      const [row] = await db
        .update(modelRoutes)
        .set({ ...body.data, updatedAt: new Date() })
        .where(eq(modelRoutes.id, params.data.id))
        .returning();

      if (!row) {
        return reply.code(404).send({ success: false, message: "路由不存在" });
      }

      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "model_route.update",
        targetType: "model_route",
        targetId: String(row.id),
        detail: body.data,
        ip: req.ip,
      });

      return { success: true, data: row };
    },
  );

  app.delete(
    "/api/admin/model-routes/:id",
    { preHandler: [requireRoles("admin")] },
    async (req, reply) => {
      const params = z.object({ id: z.coerce.number() }).safeParse(req.params);
      if (!params.success) {
        return reply.code(400).send({ success: false, message: "参数无效" });
      }

      const [row] = await db
        .delete(modelRoutes)
        .where(eq(modelRoutes.id, params.data.id))
        .returning({ id: modelRoutes.id });

      if (!row) {
        return reply.code(404).send({ success: false, message: "路由不存在" });
      }

      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "model_route.delete",
        targetType: "model_route",
        targetId: String(row.id),
        ip: req.ip,
      });

      return { success: true };
    },
  );
}
