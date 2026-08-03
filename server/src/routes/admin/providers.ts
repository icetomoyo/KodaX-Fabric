import type { FastifyInstance } from "fastify";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { productLines, providers } from "../../db/schema/index.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

export async function adminProviderRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin", "auditor"));

  app.get("/api/admin/providers", async () => {
    const rows = await db.select().from(providers).orderBy(asc(providers.id));
    const lines = await db.select().from(productLines).orderBy(asc(productLines.id));

    const data = rows.map((p) => ({
      ...p,
      productLines: lines.filter((l) => l.providerId === p.id),
    }));

    return { success: true, data };
  });

  app.get("/api/admin/product-lines", async () => {
    const lines = await db
      .select({
        id: productLines.id,
        providerId: productLines.providerId,
        code: productLines.code,
        name: productLines.name,
        productType: productLines.productType,
        baseUrlOverride: productLines.baseUrlOverride,
        shareMode: productLines.shareMode,
        allowAutoRoute: productLines.allowAutoRoute,
        status: productLines.status,
        providerCode: providers.code,
        providerName: providers.name,
        defaultBaseUrl: providers.defaultBaseUrl,
      })
      .from(productLines)
      .innerJoin(providers, eq(productLines.providerId, providers.id))
      .orderBy(asc(productLines.id));

    return { success: true, data: lines };
  });

  // Admin only writes
  app.patch(
    "/api/admin/product-lines/:id",
    { preHandler: [requireRoles("admin")] },
    async (req, reply) => {
      const params = z.object({ id: z.coerce.number() }).safeParse(req.params);
      const body = z
        .object({
          shareMode: z.enum(["public_pool", "grant_only", "disabled"]).optional(),
          allowAutoRoute: z.boolean().optional(),
          status: z.enum(["active", "disabled"]).optional(),
          baseUrlOverride: z.string().nullable().optional(),
          name: z.string().min(1).max(100).optional(),
        })
        .safeParse(req.body);

      if (!params.success || !body.success) {
        return reply.code(400).send({ success: false, message: "参数无效" });
      }

      const [row] = await db
        .update(productLines)
        .set({ ...body.data, updatedAt: new Date() })
        .where(eq(productLines.id, params.data.id))
        .returning();

      if (!row) {
        return reply.code(404).send({ success: false, message: "产品线不存在" });
      }

      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "product_line.update",
        targetType: "product_line",
        targetId: String(row.id),
        detail: body.data,
        ip: req.ip,
      });

      return { success: true, data: row };
    },
  );

  app.patch(
    "/api/admin/providers/:id",
    { preHandler: [requireRoles("admin")] },
    async (req, reply) => {
      const params = z.object({ id: z.coerce.number() }).safeParse(req.params);
      const body = z
        .object({
          name: z.string().min(1).max(100).optional(),
          defaultBaseUrl: z.string().url().or(z.string().min(1)).optional(),
          status: z.enum(["active", "disabled"]).optional(),
        })
        .safeParse(req.body);

      if (!params.success || !body.success) {
        return reply.code(400).send({ success: false, message: "参数无效" });
      }

      const [row] = await db
        .update(providers)
        .set({ ...body.data, updatedAt: new Date() })
        .where(eq(providers.id, params.data.id))
        .returning();

      if (!row) {
        return reply.code(404).send({ success: false, message: "供应商不存在" });
      }

      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "provider.update",
        targetType: "provider",
        targetId: String(row.id),
        detail: body.data,
        ip: req.ip,
      });

      return { success: true, data: row };
    },
  );
}
