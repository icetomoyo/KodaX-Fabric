import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  credentialEmployeeGrants,
  employees,
  productLines,
  providers,
  upstreamCredentials,
} from "../../db/schema/index.js";
import { encryptSecret, secretSuffix } from "../../lib/crypto-secret.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

export async function adminCredentialRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin", "auditor"));

  app.get("/api/admin/credentials", async (req) => {
    const query = z
      .object({
        productLineId: z.coerce.number().optional(),
        status: z.string().optional(),
      })
      .parse(req.query);

    const rows = await db
      .select({
        id: upstreamCredentials.id,
        productLineId: upstreamCredentials.productLineId,
        label: upstreamCredentials.label,
        secretSuffix: upstreamCredentials.secretSuffix,
        weight: upstreamCredentials.weight,
        priority: upstreamCredentials.priority,
        status: upstreamCredentials.status,
        coolUntil: upstreamCredentials.coolUntil,
        lastError: upstreamCredentials.lastError,
        lastErrorAt: upstreamCredentials.lastErrorAt,
        successCount: upstreamCredentials.successCount,
        errorCount: upstreamCredentials.errorCount,
        lastUsedAt: upstreamCredentials.lastUsedAt,
        meta: upstreamCredentials.meta,
        createdAt: upstreamCredentials.createdAt,
        updatedAt: upstreamCredentials.updatedAt,
        productLineCode: productLines.code,
        productType: productLines.productType,
        shareMode: productLines.shareMode,
        providerCode: providers.code,
        providerName: providers.name,
      })
      .from(upstreamCredentials)
      .innerJoin(productLines, eq(upstreamCredentials.productLineId, productLines.id))
      .innerJoin(providers, eq(productLines.providerId, providers.id))
      .where(
        and(
          query.productLineId
            ? eq(upstreamCredentials.productLineId, query.productLineId)
            : undefined,
          query.status ? eq(upstreamCredentials.status, query.status as "active") : undefined,
        ),
      )
      .orderBy(desc(upstreamCredentials.id));

    return { success: true, data: rows };
  });

  app.post(
    "/api/admin/credentials",
    { preHandler: [requireRoles("admin")] },
    async (req, reply) => {
      const body = z
        .object({
          productLineId: z.number().int().positive(),
          label: z.string().min(1).max(200),
          secret: z.string().min(4),
          weight: z.number().int().min(0).max(10000).default(100),
          priority: z.number().int().default(0),
          meta: z.record(z.unknown()).optional(),
        })
        .safeParse(req.body);

      if (!body.success) {
        return reply.code(400).send({ success: false, message: "参数无效" });
      }

      const [pl] = await db
        .select({ id: productLines.id })
        .from(productLines)
        .where(eq(productLines.id, body.data.productLineId))
        .limit(1);
      if (!pl) {
        return reply.code(400).send({ success: false, message: "产品线不存在" });
      }

      const [row] = await db
        .insert(upstreamCredentials)
        .values({
          productLineId: body.data.productLineId,
          label: body.data.label,
          secretEncrypted: encryptSecret(body.data.secret),
          secretSuffix: secretSuffix(body.data.secret),
          weight: body.data.weight,
          priority: body.data.priority,
          meta: body.data.meta,
          status: "active",
        })
        .returning({
          id: upstreamCredentials.id,
          label: upstreamCredentials.label,
          secretSuffix: upstreamCredentials.secretSuffix,
          productLineId: upstreamCredentials.productLineId,
          status: upstreamCredentials.status,
        });

      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "credential.create",
        targetType: "upstream_credential",
        targetId: String(row.id),
        detail: { label: row.label, productLineId: row.productLineId },
        ip: req.ip,
      });

      return { success: true, data: row };
    },
  );

  app.patch(
    "/api/admin/credentials/:id",
    { preHandler: [requireRoles("admin")] },
    async (req, reply) => {
      const params = z.object({ id: z.coerce.number() }).safeParse(req.params);
      const body = z
        .object({
          label: z.string().min(1).max(200).optional(),
          secret: z.string().min(4).optional(),
          weight: z.number().int().min(0).max(10000).optional(),
          priority: z.number().int().optional(),
          status: z
            .enum(["active", "disabled", "auto_disabled", "cooling"])
            .optional(),
          coolUntil: z.string().datetime().nullable().optional(),
          meta: z.record(z.unknown()).nullable().optional(),
        })
        .safeParse(req.body);

      if (!params.success || !body.success) {
        return reply.code(400).send({ success: false, message: "参数无效" });
      }

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (body.data.label !== undefined) patch.label = body.data.label;
      if (body.data.weight !== undefined) patch.weight = body.data.weight;
      if (body.data.priority !== undefined) patch.priority = body.data.priority;
      if (body.data.status !== undefined) {
        patch.status = body.data.status;
        if (body.data.status === "active") {
          patch.coolUntil = null;
          patch.lastError = null;
        }
      }
      if (body.data.coolUntil !== undefined) {
        patch.coolUntil = body.data.coolUntil ? new Date(body.data.coolUntil) : null;
      }
      if (body.data.meta !== undefined) patch.meta = body.data.meta;
      if (body.data.secret) {
        patch.secretEncrypted = encryptSecret(body.data.secret);
        patch.secretSuffix = secretSuffix(body.data.secret);
      }

      const [row] = await db
        .update(upstreamCredentials)
        .set(patch)
        .where(eq(upstreamCredentials.id, params.data.id))
        .returning({
          id: upstreamCredentials.id,
          label: upstreamCredentials.label,
          status: upstreamCredentials.status,
          secretSuffix: upstreamCredentials.secretSuffix,
        });

      if (!row) {
        return reply.code(404).send({ success: false, message: "凭证不存在" });
      }

      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "credential.update",
        targetType: "upstream_credential",
        targetId: String(row.id),
        detail: {
          ...body.data,
          secret: body.data.secret ? "[updated]" : undefined,
        },
        ip: req.ip,
      });

      return { success: true, data: row };
    },
  );

  // Coding plan style grants
  app.get(
    "/api/admin/credentials/:id/grants",
    { preHandler: [requireRoles("admin")] },
    async (req, reply) => {
      const params = z.object({ id: z.coerce.number() }).safeParse(req.params);
      if (!params.success) {
        return reply.code(400).send({ success: false, message: "参数无效" });
      }

      const rows = await db
        .select({
          id: credentialEmployeeGrants.id,
          employeeId: credentialEmployeeGrants.employeeId,
          employeeName: employees.name,
          employeePhone: employees.phone,
          grantedBy: credentialEmployeeGrants.grantedBy,
          createdAt: credentialEmployeeGrants.createdAt,
        })
        .from(credentialEmployeeGrants)
        .innerJoin(employees, eq(credentialEmployeeGrants.employeeId, employees.id))
        .where(eq(credentialEmployeeGrants.credentialId, params.data.id))
        .orderBy(asc(credentialEmployeeGrants.id));

      return { success: true, data: rows };
    },
  );

  app.post(
    "/api/admin/credentials/:id/grants",
    { preHandler: [requireRoles("admin")] },
    async (req, reply) => {
      const params = z.object({ id: z.coerce.number() }).safeParse(req.params);
      const body = z.object({ employeeId: z.number().int().positive() }).safeParse(req.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ success: false, message: "参数无效" });
      }

      try {
        const [row] = await db
          .insert(credentialEmployeeGrants)
          .values({
            credentialId: params.data.id,
            employeeId: body.data.employeeId,
            grantedBy: req.employeeId,
          })
          .returning();

        await writeOpsAudit({
          actorEmployeeId: req.employeeId,
          action: "credential.grant",
          targetType: "upstream_credential",
          targetId: String(params.data.id),
          detail: { employeeId: body.data.employeeId },
          ip: req.ip,
        });

        return { success: true, data: row };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("unique")) {
          return reply.code(409).send({ success: false, message: "已授权该员工" });
        }
        throw e;
      }
    },
  );

  app.delete(
    "/api/admin/credentials/:id/grants/:grantId",
    { preHandler: [requireRoles("admin")] },
    async (req, reply) => {
      const params = z
        .object({ id: z.coerce.number(), grantId: z.coerce.number() })
        .safeParse(req.params);
      if (!params.success) {
        return reply.code(400).send({ success: false, message: "参数无效" });
      }

      const [row] = await db
        .delete(credentialEmployeeGrants)
        .where(
          and(
            eq(credentialEmployeeGrants.id, params.data.grantId),
            eq(credentialEmployeeGrants.credentialId, params.data.id),
          ),
        )
        .returning();

      if (!row) {
        return reply.code(404).send({ success: false, message: "授权不存在" });
      }

      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "credential.ungrant",
        targetType: "upstream_credential",
        targetId: String(params.data.id),
        detail: { grantId: params.data.grantId, employeeId: row.employeeId },
        ip: req.ip,
      });

      return { success: true };
    },
  );
}
