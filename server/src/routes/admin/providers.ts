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

  app.post(
    "/api/admin/providers",
    { preHandler: [requireRoles("admin")] },
    async (req, reply) => {
      const body = z
        .object({
          code: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/i, "code 仅允许字母数字下划线"),
          name: z.string().min(1).max(100),
          defaultBaseUrl: z.string().min(1),
          authStyle: z.enum(["bearer", "x-api-key"]).default("bearer"),
          status: z.enum(["active", "disabled"]).default("active"),
          withApiLine: z.boolean().default(true),
        })
        .safeParse(req.body);

      if (!body.success) {
        return reply.code(400).send({ success: false, message: "参数无效", errors: body.error.flatten() });
      }

      try {
        const [row] = await db
          .insert(providers)
          .values({
            code: body.data.code,
            name: body.data.name,
            defaultBaseUrl: body.data.defaultBaseUrl,
            authStyle: body.data.authStyle,
            status: body.data.status,
          })
          .returning();

        if (body.data.withApiLine) {
          await db.insert(productLines).values({
            providerId: row.id,
            code: "api",
            name: "API",
            productType: "api",
            shareMode: "public_pool",
            allowAutoRoute: true,
            status: "active",
          });
        }

        await writeOpsAudit({
          actorEmployeeId: req.employeeId,
          action: "provider.create",
          targetType: "provider",
          targetId: String(row.id),
          detail: { code: row.code, withApiLine: body.data.withApiLine },
          ip: req.ip,
        });

        return { success: true, data: row };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("unique") || msg.includes("providers_code")) {
          return reply.code(409).send({ success: false, message: "供应商 code 已存在" });
        }
        throw e;
      }
    },
  );

  app.post(
    "/api/admin/product-lines",
    { preHandler: [requireRoles("admin")] },
    async (req, reply) => {
      const body = z
        .object({
          providerId: z.number().int().positive(),
          code: z.string().min(1).max(64),
          name: z.string().min(1).max(100),
          productType: z.enum(["api", "coding_plan"]),
          shareMode: z.enum(["public_pool", "grant_only", "disabled"]).default("public_pool"),
          allowAutoRoute: z.boolean().default(true),
          baseUrlOverride: z.string().nullable().optional(),
        })
        .safeParse(req.body);

      if (!body.success) {
        return reply.code(400).send({ success: false, message: "参数无效" });
      }

      try {
        const [row] = await db
          .insert(productLines)
          .values({
            providerId: body.data.providerId,
            code: body.data.code,
            name: body.data.name,
            productType: body.data.productType,
            shareMode: body.data.shareMode,
            allowAutoRoute: body.data.allowAutoRoute,
            baseUrlOverride: body.data.baseUrlOverride ?? null,
            status: "active",
          })
          .returning();

        await writeOpsAudit({
          actorEmployeeId: req.employeeId,
          action: "product_line.create",
          targetType: "product_line",
          targetId: String(row.id),
          detail: body.data,
          ip: req.ip,
        });

        return { success: true, data: row };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("unique")) {
          return reply.code(409).send({ success: false, message: "该供应商下产品线 code 已存在" });
        }
        throw e;
      }
    },
  );

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
          authStyle: z.enum(["bearer", "x-api-key"]).optional(),
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
