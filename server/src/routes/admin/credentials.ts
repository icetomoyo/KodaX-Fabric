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
import { decryptSecret, encryptSecret, secretSuffix } from "../../lib/crypto-secret.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import {
  getProviderTemplate,
  isAllowedTemplateHost,
  PROVIDER_TEMPLATES,
  resolveTemplateBaseUrlOption,
} from "../../lib/provider-templates.js";
import {
  DEFAULT_RELAY_PROTOCOL,
  RELAY_PROTOCOLS,
  type RelayProtocol,
} from "../../lib/relay/protocol.js";
import {
  buildRelayUpstreamHeaders,
  buildRelayUpstreamUrl,
} from "../../lib/relay/upstream.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

type CredentialTestResult = {
  ok: boolean;
  testedAt: string;
  latencyMs: number;
  httpStatus: number | null;
  modelCount: number;
  models: string[];
  message: string;
};

const supportedProtocolsSchema = z
  .array(z.enum(RELAY_PROTOCOLS))
  .min(1)
  .max(RELAY_PROTOCOLS.length)
  .refine((values) => new Set(values).size === values.length, {
    message: "支持协议不能重复",
  });

function parseModels(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];

  return data
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
        return (item as { id: string }).id;
      }
      return null;
    })
    .filter((item): item is string => Boolean(item))
    .slice(0, 200);
}

function errorSummary(status: number, raw: string): string {
  let detail = raw.trim();
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: unknown } | string;
      message?: unknown;
    };
    if (typeof parsed.error === "string") detail = parsed.error;
    if (parsed.error && typeof parsed.error === "object" && typeof parsed.error.message === "string") {
      detail = parsed.error.message;
    }
    if (typeof parsed.message === "string") detail = parsed.message;
  } catch {
    // Keep the text response when the upstream does not return JSON.
  }
  const suffix = detail ? `：${detail.slice(0, 500)}` : "";
  return `上游返回 HTTP ${status}${suffix}`;
}

async function testCredentialConnection(credentialId: number): Promise<CredentialTestResult> {
  const [credential] = await db
    .select({
      id: upstreamCredentials.id,
      secretEncrypted: upstreamCredentials.secretEncrypted,
      meta: upstreamCredentials.meta,
      supportedProtocols: upstreamCredentials.supportedProtocols,
      providerCode: providers.code,
      authStyle: providers.authStyle,
      defaultBaseUrl: providers.defaultBaseUrl,
      baseUrlOverride: productLines.baseUrlOverride,
    })
    .from(upstreamCredentials)
    .innerJoin(productLines, eq(upstreamCredentials.productLineId, productLines.id))
    .innerJoin(providers, eq(productLines.providerId, providers.id))
    .where(eq(upstreamCredentials.id, credentialId))
    .limit(1);

  if (!credential) {
    throw new Error("凭证不存在");
  }

  const template = getProviderTemplate(credential.providerCode);
  const baseUrl = (credential.baseUrlOverride || credential.defaultBaseUrl).replace(/\/+$/, "");
  if (!template || !isAllowedTemplateHost(template, baseUrl)) {
    throw new Error("当前仅支持对已确认供应商的官方 HTTPS 地址进行连通性测试");
  }

  const testedAt = new Date().toISOString();
  const startedAt = Date.now();
  let result: CredentialTestResult;

  try {
    const protocol: RelayProtocol = credential.supportedProtocols.includes(
      "anthropic_messages",
    )
      ? "anthropic_messages"
      : credential.supportedProtocols.includes("openai_responses")
        ? "openai_responses"
        : DEFAULT_RELAY_PROTOCOL;
    const secret = decryptSecret(credential.secretEncrypted);
    const response = await fetch(buildRelayUpstreamUrl(baseUrl, protocol, "models"), {
      method: "GET",
      headers: buildRelayUpstreamHeaders({
        protocol,
        authStyle: credential.authStyle,
        secret,
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
    });
    const raw = await response.text();
    let payload: unknown = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }
    const models = response.ok ? parseModels(payload) : [];
    result = {
      ok: response.ok,
      testedAt,
      latencyMs: Date.now() - startedAt,
      httpStatus: response.status,
      modelCount: models.length,
      models,
      message: response.ok
        ? models.length
          ? `连接成功，发现 ${models.length} 个模型`
          : "连接成功，上游未返回可识别的模型列表"
        : errorSummary(response.status, raw),
    };
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "连接超时（12 秒）"
      : error instanceof Error
        ? error.message
        : String(error);
    result = {
      ok: false,
      testedAt,
      latencyMs: Date.now() - startedAt,
      httpStatus: null,
      modelCount: 0,
      models: [],
      message,
    };
  }

  const previousMeta = credential.meta && typeof credential.meta === "object"
    ? credential.meta as Record<string, unknown>
    : {};
  await db
    .update(upstreamCredentials)
    .set({
      meta: {
        ...previousMeta,
        lastTest: result,
        discoveredModels: result.models,
      },
      lastError: result.ok ? null : result.message,
      lastErrorAt: result.ok ? null : new Date(),
      updatedAt: new Date(),
    })
    .where(eq(upstreamCredentials.id, credential.id));

  return result;
}

export async function adminCredentialRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin", "auditor"));

  app.get("/api/admin/credential-templates", async () => {
    const providerRows = await db.select().from(providers);
    const lineRows = await db.select().from(productLines);

    return {
      success: true,
      data: PROVIDER_TEMPLATES.map((template) => {
        const provider = providerRows.find((item) => item.code === template.code);
        const lines = provider
          ? lineRows.filter((item) => item.providerId === provider.id)
          : [];
        return {
          ...template,
          configured: Boolean(provider),
          providerId: provider?.id ?? null,
          productLines: lines.map((line) => ({
            id: line.id,
            code: line.code,
            name: line.name,
            baseUrl: line.baseUrlOverride || provider?.defaultBaseUrl,
            status: line.status,
          })),
        };
      }),
    };
  });

  app.post(
    "/api/admin/credentials/quick-create",
    { preHandler: [requireRoles("admin")] },
    async (req, reply) => {
      const body = z
        .object({
          providerCode: z.enum(["glm", "kimi", "deepseek", "minimax"]),
          baseUrl: z.string().url().optional(),
          label: z.string().trim().min(1).max(200),
          secret: z.string().trim().min(4),
          supportedProtocols: supportedProtocolsSchema.default([DEFAULT_RELAY_PROTOCOL]),
          weight: z.number().int().min(0).max(10000).default(100),
          priority: z.number().int().min(-1000).max(1000).default(0),
          testAfterCreate: z.boolean().default(true),
        })
        .safeParse(req.body);

      if (!body.success) {
        return reply.code(400).send({
          success: false,
          message: "凭证参数无效",
          errors: body.error.flatten(),
        });
      }

      const template = getProviderTemplate(body.data.providerCode);
      if (!template) {
        return reply.code(400).send({ success: false, message: "暂不支持该供应商" });
      }
      const baseUrlOption = resolveTemplateBaseUrlOption(template, body.data.baseUrl);
      if (!baseUrlOption) {
        return reply.code(400).send({
          success: false,
          message: "Base URL 必须选择该供应商的官方地址",
        });
      }

      const created = await db.transaction(async (tx) => {
        let [provider] = await tx
          .select()
          .from(providers)
          .where(eq(providers.code, template.code))
          .limit(1);

        if (!provider) {
          [provider] = await tx
            .insert(providers)
            .values({
              code: template.code,
              name: template.name,
              defaultBaseUrl: template.baseUrls[0].url,
              authStyle: template.authStyle,
              openaiCompatLevel: "full",
              status: "active",
            })
            .returning();
        }

        let [productLine] = await tx
          .select()
          .from(productLines)
          .where(
            and(
              eq(productLines.providerId, provider.id),
              eq(productLines.code, baseUrlOption.productLineCode),
            ),
          )
          .limit(1);

        if (!productLine) {
          [productLine] = await tx
            .insert(productLines)
            .values({
              providerId: provider.id,
              code: baseUrlOption.productLineCode,
              name: baseUrlOption.productLineName,
              productType: "api",
              baseUrlOverride:
                baseUrlOption.url === provider.defaultBaseUrl ? null : baseUrlOption.url,
              shareMode: "public_pool",
              allowAutoRoute: true,
              status: "active",
            })
            .returning();
        }

        const [credential] = await tx
          .insert(upstreamCredentials)
          .values({
            productLineId: productLine.id,
            label: body.data.label,
            secretEncrypted: encryptSecret(body.data.secret),
            secretSuffix: secretSuffix(body.data.secret),
            supportedProtocols: body.data.supportedProtocols,
            weight: body.data.weight,
            priority: body.data.priority,
            meta: {
              providerTemplate: body.data.providerCode,
              createdBy: "quick_create",
            },
            status: "active",
          })
          .returning({
            id: upstreamCredentials.id,
            label: upstreamCredentials.label,
            secretSuffix: upstreamCredentials.secretSuffix,
            supportedProtocols: upstreamCredentials.supportedProtocols,
            status: upstreamCredentials.status,
          });

        return {
          credential,
          provider: { id: provider.id, code: provider.code, name: provider.name },
          productLine: {
            id: productLine.id,
            code: productLine.code,
            name: productLine.name,
          },
          baseUrl: productLine.baseUrlOverride || provider.defaultBaseUrl,
        };
      });

      let test: CredentialTestResult | null = null;
      if (body.data.testAfterCreate) {
        try {
          test = await testCredentialConnection(created.credential.id);
        } catch (error) {
          test = {
            ok: false,
            testedAt: new Date().toISOString(),
            latencyMs: 0,
            httpStatus: null,
            modelCount: 0,
            models: [],
            message: error instanceof Error ? error.message : "连接测试失败",
          };
        }
      }

      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "credential.quick_create",
        targetType: "upstream_credential",
        targetId: String(created.credential.id),
        detail: {
          providerCode: body.data.providerCode,
          productLineId: created.productLine.id,
          supportedProtocols: body.data.supportedProtocols,
          testOk: test?.ok ?? null,
        },
        ip: req.ip,
      });

      return {
        success: true,
        data: {
          ...created,
          test,
        },
      };
    },
  );

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
        supportedProtocols: upstreamCredentials.supportedProtocols,
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
        defaultBaseUrl: providers.defaultBaseUrl,
        baseUrlOverride: productLines.baseUrlOverride,
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
          supportedProtocols: supportedProtocolsSchema.default([DEFAULT_RELAY_PROTOCOL]),
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
          supportedProtocols: body.data.supportedProtocols,
          weight: body.data.weight,
          priority: body.data.priority,
          meta: body.data.meta,
          status: "active",
        })
        .returning({
          id: upstreamCredentials.id,
          label: upstreamCredentials.label,
          secretSuffix: upstreamCredentials.secretSuffix,
          supportedProtocols: upstreamCredentials.supportedProtocols,
          productLineId: upstreamCredentials.productLineId,
          status: upstreamCredentials.status,
        });

      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "credential.create",
        targetType: "upstream_credential",
        targetId: String(row.id),
        detail: {
          label: row.label,
          productLineId: row.productLineId,
          supportedProtocols: row.supportedProtocols,
        },
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
          supportedProtocols: supportedProtocolsSchema.optional(),
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
      if (body.data.supportedProtocols !== undefined) {
        patch.supportedProtocols = body.data.supportedProtocols;
      }
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
          supportedProtocols: upstreamCredentials.supportedProtocols,
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

  app.delete(
    "/api/admin/credentials/:id",
    { preHandler: [requireRoles("admin")] },
    async (req, reply) => {
      const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
      if (!params.success) {
        return reply.code(400).send({ success: false, message: "参数无效" });
      }

      const deleted = await db.transaction(async (tx) => {
        await tx
          .delete(credentialEmployeeGrants)
          .where(eq(credentialEmployeeGrants.credentialId, params.data.id));

        const [row] = await tx
          .delete(upstreamCredentials)
          .where(eq(upstreamCredentials.id, params.data.id))
          .returning({
            id: upstreamCredentials.id,
            label: upstreamCredentials.label,
            secretSuffix: upstreamCredentials.secretSuffix,
            productLineId: upstreamCredentials.productLineId,
          });

        return row ?? null;
      });

      if (!deleted) {
        return reply.code(404).send({ success: false, message: "凭证不存在" });
      }

      await writeOpsAudit({
        actorEmployeeId: req.employeeId,
        action: "credential.delete",
        targetType: "upstream_credential",
        targetId: String(deleted.id),
        detail: {
          label: deleted.label,
          secretSuffix: deleted.secretSuffix,
          productLineId: deleted.productLineId,
        },
        ip: req.ip,
      });

      return { success: true, data: { id: deleted.id } };
    },
  );

  app.post(
    "/api/admin/credentials/:id/test",
    { preHandler: [requireRoles("admin")] },
    async (req, reply) => {
      const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
      if (!params.success) {
        return reply.code(400).send({ success: false, message: "参数无效" });
      }

      try {
        const result = await testCredentialConnection(params.data.id);
        await writeOpsAudit({
          actorEmployeeId: req.employeeId,
          action: "credential.test",
          targetType: "upstream_credential",
          targetId: String(params.data.id),
          detail: {
            ok: result.ok,
            httpStatus: result.httpStatus,
            latencyMs: result.latencyMs,
            modelCount: result.modelCount,
          },
          ip: req.ip,
        });
        return { success: true, data: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : "测试失败";
        const status = message === "凭证不存在" ? 404 : 400;
        return reply.code(status).send({ success: false, message });
      }
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
