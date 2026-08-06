import type { FastifyInstance } from "fastify";
import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  employeeApiKeys,
  opsAuditLogs,
  productLines,
  providers,
  upstreamCredentials,
} from "../../db/schema/index.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import {
  getProviderTemplate,
  resolveTemplateProtocolConfigs,
} from "../../lib/provider-templates.js";
import {
  collectRemovedProtocolUsage,
  planChannelProtocolUpdate,
  upstreamChannelUpdateSchema,
} from "../../lib/upstream-channel-update.js";
import {
  configuredProtocols,
  effectiveProtocolConfigs,
  parseProductLineProtocolConfigs,
  protocolConfigsEqual,
} from "../../lib/upstream-protocol-config.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

export async function adminProviderRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin"));

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
        protocolConfigs: productLines.protocolConfigs,
        configVersion: productLines.configVersion,
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
      const params = z
        .object({ id: z.coerce.number().int().positive() })
        .safeParse(req.params);
      const body = upstreamChannelUpdateSchema.safeParse(req.body ?? {});

      if (!params.success || !body.success) {
        return reply.code(400).send({
          success: false,
          message: "渠道参数无效",
          errors: body.success ? undefined : body.error.flatten(),
        });
      }

      const result = await db.transaction(async (tx) => {
        // Credential create/import takes this lock before inserting its row.
        // Keep the same order here to avoid a parent-FK/advisory-lock deadlock.
        await tx.execute(sql`select pg_advisory_xact_lock(${params.data.id})`);
        const [existing] = await tx
          .select()
          .from(productLines)
          .where(eq(productLines.id, params.data.id))
          .limit(1)
          .for("update");

        if (!existing) return { kind: "not_found" } as const;

        if (
          body.data.expectedConfigVersion !== undefined &&
          body.data.expectedConfigVersion !== existing.configVersion
        ) {
          return {
            kind: "config_stale",
            currentConfigVersion: existing.configVersion,
          } as const;
        }

        const [provider] = await tx
          .select({
            code: providers.code,
            defaultBaseUrl: providers.defaultBaseUrl,
            authStyle: providers.authStyle,
          })
          .from(providers)
          .where(eq(providers.id, existing.providerId))
          .limit(1);
        if (!provider) return { kind: "not_found" } as const;

        const credentials = await tx
          .select({
            id: upstreamCredentials.id,
            supportedProtocols: upstreamCredentials.supportedProtocols,
          })
          .from(upstreamCredentials)
          .where(eq(upstreamCredentials.productLineId, existing.id))
          .for("update");

        const storedChannelProtocols = configuredProtocols(
          parseProductLineProtocolConfigs(existing.protocolConfigs),
        );
        const protocolPlan = planChannelProtocolUpdate(
          credentials,
          body.data.supportedProtocols,
          storedChannelProtocols,
        );

        let nextProtocolConfigs = parseProductLineProtocolConfigs(existing.protocolConfigs);
        let configActuallyChanged = false;
        if (body.data.supportedProtocols !== undefined) {
          const template = getProviderTemplate(provider.code);
          if (!template) {
            return { kind: "protocol_config_unavailable" } as const;
          }
          const resolution = resolveTemplateProtocolConfigs(
            template,
            existing.code,
            protocolPlan.nextProtocols,
          );
          if (!resolution.ok) {
            return {
              kind: "protocol_unsupported",
              unsupportedProtocols: resolution.unsupportedProtocols,
            } as const;
          }
          nextProtocolConfigs = resolution.configs;
          const currentEffectiveConfigs = effectiveProtocolConfigs({
            protocols: protocolPlan.currentProtocols,
            protocolConfigs: existing.protocolConfigs,
            legacyBaseUrl: existing.baseUrlOverride || provider.defaultBaseUrl,
            legacyAuthStyle: provider.authStyle,
          });
          configActuallyChanged = !protocolConfigsEqual(
            currentEffectiveConfigs,
            resolution.configs,
          );
        }

        if (protocolPlan.removedProtocols.length > 0) {
          const activeBindings = await tx
            .select({ protocol: employeeApiKeys.protocol })
            .from(employeeApiKeys)
            .where(
              and(
                eq(employeeApiKeys.productLineId, existing.id),
                eq(employeeApiKeys.status, "active"),
                inArray(employeeApiKeys.protocol, protocolPlan.removedProtocols),
                or(
                  isNull(employeeApiKeys.expiresAt),
                  gt(employeeApiKeys.expiresAt, new Date()),
                ),
              ),
            )
            .for("update");
          const usage = collectRemovedProtocolUsage(
            activeBindings,
            protocolPlan.removedProtocols,
          );
          if (usage.length > 0) {
            return {
              kind: "protocol_in_use",
              usage,
              activeKeyCount: usage.reduce((total, item) => total + item.activeKeyCount, 0),
            } as const;
          }
        }

        const storedProtocolConfigs = parseProductLineProtocolConfigs(existing.protocolConfigs);
        const protocolConfigsStorageChanged = body.data.supportedProtocols !== undefined &&
          (storedProtocolConfigs === null || nextProtocolConfigs === null ||
            !protocolConfigsEqual(storedProtocolConfigs, nextProtocolConfigs));
        const metadataChanged =
          (body.data.name !== undefined && body.data.name !== existing.name) ||
          (body.data.status !== undefined && body.data.status !== existing.status);
        const shouldResetCredentialHealth =
          configActuallyChanged || protocolPlan.protocolsChanged;
        const anyChannelFieldChanged = metadataChanged || protocolConfigsStorageChanged ||
          configActuallyChanged || protocolPlan.protocolsChanged;
        const nextConfigVersion = anyChannelFieldChanged
          ? existing.configVersion + 1
          : existing.configVersion;
        const updatedAt = new Date();
        const [row] = await tx
          .update(productLines)
          .set({
            ...(body.data.name !== undefined ? { name: body.data.name } : {}),
            ...(body.data.status !== undefined ? { status: body.data.status } : {}),
            ...(body.data.supportedProtocols !== undefined
              ? { protocolConfigs: nextProtocolConfigs }
              : {}),
            configVersion: nextConfigVersion,
            updatedAt,
          })
          .where(eq(productLines.id, existing.id))
          .returning();
        if (!row) return { kind: "not_found" } as const;

        if (shouldResetCredentialHealth) {
          await tx
            .update(upstreamCredentials)
            .set({
              ...(protocolPlan.protocolsChanged
                ? { supportedProtocols: protocolPlan.nextProtocols }
                : {}),
              meta: sql`coalesce(${upstreamCredentials.meta}, '{}'::jsonb) - 'lastTest' - 'discoveredModels'`,
              lastError: null,
              lastErrorAt: null,
              updatedAt,
            })
            .where(eq(upstreamCredentials.productLineId, existing.id));
        }

        const changedFields = Object.keys(body.data).filter(
          (field) => field !== "expectedConfigVersion",
        );
        await tx.insert(opsAuditLogs).values({
          actorEmployeeId: req.employeeId ?? null,
          action: "product_line.update",
          targetType: "product_line",
          targetId: String(row.id),
          detail: {
            changedFields,
            configVersionBefore: existing.configVersion,
            configVersionAfter: nextConfigVersion,
            before: {
              ...(body.data.name !== undefined ? { name: existing.name } : {}),
              ...(body.data.status !== undefined ? { status: existing.status } : {}),
              ...(body.data.supportedProtocols !== undefined
                ? {
                  supportedProtocols: protocolPlan.currentProtocols,
                  protocolConfigs: existing.protocolConfigs,
                  configVersion: existing.configVersion,
                }
                : {}),
            },
            after: {
              ...(body.data.name !== undefined ? { name: row.name } : {}),
              ...(body.data.status !== undefined ? { status: row.status } : {}),
              ...(body.data.supportedProtocols !== undefined
                ? {
                  supportedProtocols: protocolPlan.nextProtocols,
                  protocolConfigs: nextProtocolConfigs,
                  configVersion: nextConfigVersion,
                }
                : {}),
            },
            credentialCount: credentials.length,
            credentialHealthReset: shouldResetCredentialHealth,
          },
          ip: req.ip,
        });

        return {
          kind: "updated",
          row,
          supportedProtocols: protocolPlan.nextProtocols,
          protocolConfigs: nextProtocolConfigs,
          configVersion: nextConfigVersion,
          credentialCount: credentials.length,
          credentialHealthReset: shouldResetCredentialHealth,
        } as const;
      });

      if (result.kind === "not_found") {
        return reply.code(404).send({ success: false, message: "产品线不存在" });
      }
      if (result.kind === "config_stale") {
        return reply.code(409).send({
          success: false,
          code: "CHANNEL_CONFIG_STALE",
          message: "渠道配置已被其他操作更新，请刷新后重试",
          currentConfigVersion: result.currentConfigVersion,
        });
      }
      if (result.kind === "protocol_config_unavailable") {
        return reply.code(400).send({
          success: false,
          code: "CHANNEL_PROTOCOL_CONFIG_UNAVAILABLE",
          message: "当前供应商模板无法自动生成协议端点配置",
        });
      }
      if (result.kind === "protocol_unsupported") {
        return reply.code(400).send({
          success: false,
          code: "CHANNEL_PROTOCOL_UNSUPPORTED",
          message: "当前渠道不支持所选协议",
          unsupportedProtocols: result.unsupportedProtocols,
        });
      }
      if (result.kind === "protocol_in_use") {
        const protocols = result.usage.map((item) => item.protocol);
        return reply.code(409).send({
          success: false,
          code: "PROTOCOL_IN_USE",
          message: `无法移除协议：仍有 ${result.activeKeyCount} 个有效员工 API Key 正在使用 ${protocols.join("、")}`,
          protocols,
          activeKeyCount: result.activeKeyCount,
          usage: result.usage,
        });
      }

      return {
        success: true,
        data: {
          ...result.row,
          supportedProtocols: result.supportedProtocols,
          protocolConfigs: result.protocolConfigs,
          configVersion: result.configVersion,
          credentialCount: result.credentialCount,
          credentialHealthReset: result.credentialHealthReset,
        },
      };
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
