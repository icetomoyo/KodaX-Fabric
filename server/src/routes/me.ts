import type { FastifyInstance } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, sql as querySql } from "../db/client.js";
import {
  employeeApiKeys,
  employees,
  opsAuditLogs,
  productLines,
  providers,
  requestAuditBodies,
  requestAudits,
  usageCountersDaily,
} from "../db/schema/index.js";
import { encryptEmployeeApiKey, generateApiKey } from "../lib/api-key.js";
import { CONFIGURABLE_RELAY_PROTOCOLS } from "../lib/relay/protocol.js";
import {
  getEmployeeUpstreamChannel,
  getEmployeeUpstreamChannels,
} from "../lib/upstream-channel-metadata.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../middleware/auth.js";

const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
  productLineId: z.number().int().positive(),
  protocol: z.enum(CONFIGURABLE_RELAY_PROTOCOLS),
});

export async function meRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("employee"));

  app.get("/api/me/upstream-channels", async (req) => {
    const channels = await getEmployeeUpstreamChannels(req.employeeId!);
    return { success: true, data: channels };
  });

  app.get("/api/me/api-keys", async (req) => {
    const rows = await db
      .select({
        id: employeeApiKeys.id,
        name: employeeApiKeys.name,
        keyPrefix: employeeApiKeys.keyPrefix,
        protocol: employeeApiKeys.protocol,
        productLineId: employeeApiKeys.productLineId,
        productLineName: productLines.name,
        providerCode: providers.code,
        providerName: providers.name,
        status: employeeApiKeys.status,
        lastUsedAt: employeeApiKeys.lastUsedAt,
        createdAt: employeeApiKeys.createdAt,
      })
      .from(employeeApiKeys)
      .innerJoin(productLines, eq(employeeApiKeys.productLineId, productLines.id))
      .innerJoin(providers, eq(productLines.providerId, providers.id))
      .where(eq(employeeApiKeys.employeeId, req.employeeId!))
      .orderBy(desc(employeeApiKeys.id));

    return { success: true, data: rows };
  });

  app.post("/api/me/api-keys", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Pragma", "no-cache");
    const body = createApiKeySchema.safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({
        success: false,
        code: "invalid_request",
        message: "参数无效",
      });
    }

    const { raw, prefix, hash } = generateApiKey();
    const keyEncrypted = encryptEmployeeApiKey(raw);
    const result = await db.transaction(async (tx) => {
      // Serialize Key creation with admin role changes. Without this lock, an
      // employee request that passed the pre-handler immediately before an
      // employee -> admin/auditor transition could insert a new active Key
      // after the transition transaction had already revoked the old ones.
      const [owner] = await tx
        .select({
          role: employees.role,
          status: employees.status,
          mustChangePassword: employees.mustChangePassword,
        })
        .from(employees)
        .where(eq(employees.id, req.employeeId!))
        .limit(1)
        .for("update");

      if (
        !owner ||
        owner.role !== "employee" ||
        owner.status !== "active" ||
        owner.mustChangePassword
      ) {
        return { outcome: "forbidden" } as const;
      }

      // Serialize employee Key creation with channel protocol/config edits.
      await tx.execute(
        sql`select pg_advisory_xact_lock(${body.data.productLineId})`,
      );

      const channel = await getEmployeeUpstreamChannel(
        req.employeeId!,
        body.data.productLineId,
        tx,
        { lockForCreate: true },
      );
      if (!channel) {
        return { outcome: "channel_unavailable" } as const;
      }
      if (!channel.compatibleProtocols.includes(body.data.protocol)) {
        return { outcome: "protocol_incompatible" } as const;
      }

      const [created] = await tx
        .insert(employeeApiKeys)
        .values({
          employeeId: req.employeeId!,
          name: body.data.name,
          keyPrefix: prefix,
          keyHash: hash,
          keyEncrypted,
          protocol: body.data.protocol,
          productLineId: body.data.productLineId,
        })
        .returning({
          id: employeeApiKeys.id,
          name: employeeApiKeys.name,
          keyPrefix: employeeApiKeys.keyPrefix,
          protocol: employeeApiKeys.protocol,
          productLineId: employeeApiKeys.productLineId,
          status: employeeApiKeys.status,
          createdAt: employeeApiKeys.createdAt,
        });

      await tx.insert(opsAuditLogs).values({
        actorEmployeeId: req.employeeId,
        action: "api_key.create",
        targetType: "employee_api_key",
        targetId: String(created.id),
        detail: {
          productLineId: created.productLineId,
          productLineName: channel.productLineName,
          providerCode: channel.providerCode,
          providerName: channel.providerName,
          protocol: created.protocol,
        },
        ip: req.ip,
      });

      return { outcome: "created", row: created, channel } as const;
    });

    if (result.outcome === "forbidden") {
      return reply.code(403).send({
        success: false,
        code: "forbidden",
        message: "权限不足",
      });
    }
    if (result.outcome === "channel_unavailable") {
      return reply.code(404).send({
        success: false,
        code: "upstream_channel_unavailable",
        message: "上游渠道不可用，请重新选择",
      });
    }
    if (result.outcome === "protocol_incompatible") {
      return reply.code(400).send({
        success: false,
        code: "channel_protocol_incompatible",
        message: "所选协议与上游渠道不兼容",
      });
    }

    return {
      success: true,
      data: {
        ...result.row,
        productLineName: result.channel.productLineName,
        providerCode: result.channel.providerCode,
        providerName: result.channel.providerName,
        key: raw,
      },
    };
  });

  app.delete("/api/me/api-keys/:id", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const row = await db.transaction(async (tx) => {
      const [target] = await tx
        .select({
          id: employeeApiKeys.id,
          name: employeeApiKeys.name,
          keyPrefix: employeeApiKeys.keyPrefix,
          protocol: employeeApiKeys.protocol,
          productLineId: employeeApiKeys.productLineId,
          productLineName: productLines.name,
          providerCode: providers.code,
          providerName: providers.name,
        })
        .from(employeeApiKeys)
        .innerJoin(productLines, eq(employeeApiKeys.productLineId, productLines.id))
        .innerJoin(providers, eq(productLines.providerId, providers.id))
        .where(
          and(
            eq(employeeApiKeys.id, params.data.id),
            eq(employeeApiKeys.employeeId, req.employeeId!),
          ),
        )
        .limit(1);

      if (!target) return null;

      await tx
        .delete(employeeApiKeys)
        .where(
          and(
            eq(employeeApiKeys.id, target.id),
            eq(employeeApiKeys.employeeId, req.employeeId!),
          ),
        );

      await tx.insert(opsAuditLogs).values({
        actorEmployeeId: req.employeeId,
        action: "api_key.delete",
        targetType: "employee_api_key",
        targetId: String(target.id),
        detail: {
          name: target.name,
          keyPrefix: target.keyPrefix,
          protocol: target.protocol,
          productLineId: target.productLineId,
          productLineName: target.productLineName,
          providerCode: target.providerCode,
          providerName: target.providerName,
        },
        ip: req.ip,
      });

      return target;
    });

    if (!row) {
      return reply.code(404).send({ success: false, message: "密钥不存在" });
    }

    return { success: true };
  });

  app.get("/api/me/usage", async (req) => {
    const [{ today }] = await querySql<{ today: string }[]>`
      select current_date::text as today
    `;
    const [day] = await db
      .select()
      .from(usageCountersDaily)
      .where(
        and(
          eq(usageCountersDaily.employeeId, req.employeeId!),
          eq(usageCountersDaily.day, today),
        ),
      )
      .limit(1);

    const [month] = await db
      .select({
        totalTokens: sql<number>`coalesce(sum(${usageCountersDaily.totalTokens}), 0)`,
        requestCount: sql<number>`coalesce(sum(${usageCountersDaily.requestCount}), 0)`,
      })
      .from(usageCountersDaily)
      .where(
        and(
          eq(usageCountersDaily.employeeId, req.employeeId!),
          sql`${usageCountersDaily.day} >= date_trunc('month', current_date)::date`,
        ),
      );

    return {
      success: true,
      data: {
        today: day ?? {
          day: today,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          requestCount: 0,
          errorCount: 0,
        },
        month: {
          totalTokens: Number(month?.totalTokens ?? 0),
          requestCount: Number(month?.requestCount ?? 0),
        },
        relay: {
          baseUrl: `${req.protocol}://${req.hostname}:${process.env.PORT ?? 3100}/v1`,
          note: "Authorization: Bearer <your employee API key>",
        },
      },
    };
  });

  app.get("/api/me/logs", async (req) => {
    const query = z
      .object({
        limit: z.coerce.number().min(1).max(100).default(20),
        offset: z.coerce.number().min(0).default(0),
      })
      .parse(req.query);

    const rows = await db
      .select({
        id: requestAudits.id,
        requestId: requestAudits.requestId,
        protocol: requestAudits.protocol,
        clientModel: requestAudits.clientModel,
        providerCode: requestAudits.providerCode,
        productType: requestAudits.productType,
        status: requestAudits.status,
        totalTokens: requestAudits.totalTokens,
        latencyMs: requestAudits.latencyMs,
        createdAt: requestAudits.createdAt,
      })
      .from(requestAudits)
      .where(eq(requestAudits.employeeId, req.employeeId!))
      .orderBy(desc(requestAudits.id))
      .limit(query.limit)
      .offset(query.offset);

    return { success: true, data: rows };
  });

  app.get("/api/me/logs/:requestId", async (req, reply) => {
    const params = z.object({ requestId: z.string().min(1) }).safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const [meta] = await db
      .select()
      .from(requestAudits)
      .where(
        and(
          eq(requestAudits.requestId, params.data.requestId),
          eq(requestAudits.employeeId, req.employeeId!),
        ),
      )
      .limit(1);

    if (!meta) {
      return reply.code(404).send({ success: false, message: "记录不存在" });
    }

    const [body] = await db
      .select()
      .from(requestAuditBodies)
      .where(eq(requestAuditBodies.requestId, params.data.requestId))
      .limit(1);

    return {
      success: true,
      data: {
        meta,
        body: body ?? null,
      },
    };
  });
}
