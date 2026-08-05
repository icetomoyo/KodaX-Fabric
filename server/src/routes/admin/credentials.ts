import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  credentialEmployeeGrants,
  employees,
  opsAuditLogs,
  productLines,
  providers,
  requestAudits,
  upstreamCredentials,
} from "../../db/schema/index.js";
import { inspectCredentialSecretDuplicates } from "../../lib/credential-bulk.js";
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
  protocol: RelayProtocol;
};

type BulkProductLineContext = {
  productLine: typeof productLines.$inferSelect;
  provider: typeof providers.$inferSelect;
  baseUrl: string;
};

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1_000;

const supportedProtocolsSchema = z
  .array(z.enum(RELAY_PROTOCOLS))
  .min(1)
  .max(RELAY_PROTOCOLS.length)
  .refine((values) => new Set(values).size === values.length, {
    message: "支持协议不能重复",
  });

const upstreamSecretSchema = z
  .string()
  .trim()
  .min(8, "上游 Key 至少需要 8 个字符")
  .max(4096, "上游 Key 最多允许 4096 个字符");

const bulkCredentialDefaultsSchema = z.object({
  supportedProtocols: supportedProtocolsSchema.optional(),
  weight: z.number().int().min(0).max(10000).optional(),
  priority: z.number().int().min(-1000).max(1000).optional(),
});

const optionalCredentialLabelSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).max(200).optional(),
);

const bulkCredentialCreateSchema = z
  .object({
    productLineId: z.number().int().positive().optional(),
    providerCode: z.string().trim().min(1).max(64).optional(),
    baseUrl: z.string().url().optional(),
    keys: z
      .array(
        z.object({
          label: optionalCredentialLabelSchema,
          secret: upstreamSecretSchema,
        }),
      )
      .min(1)
      .max(200),
    defaults: bulkCredentialDefaultsSchema.optional(),
    // Also accept the originally proposed flat form for API compatibility.
    supportedProtocols: supportedProtocolsSchema.optional(),
    weight: z.number().int().min(0).max(10000).optional(),
    priority: z.number().int().min(-1000).max(1000).optional(),
  })
  .superRefine((value, context) => {
    const locatesById = value.productLineId !== undefined;
    const hasProviderLocator = value.providerCode !== undefined || value.baseUrl !== undefined;

    if (locatesById === hasProviderLocator) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "必须且只能通过 productLineId 或 providerCode + baseUrl 定位渠道",
        path: ["productLineId"],
      });
    }
    if (hasProviderLocator && (!value.providerCode || !value.baseUrl)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "providerCode 和 baseUrl 必须同时提供",
        path: value.providerCode ? ["baseUrl"] : ["providerCode"],
      });
    }
  });

const bulkCredentialIdsSchema = z
  .array(z.number().int().positive())
  .min(1)
  .max(200)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "凭证 ID 不能重复",
  });

const bulkCredentialStatusSchema = z.object({
  ids: bulkCredentialIdsSchema,
  status: z.enum(["active", "disabled"]),
});

const bulkCredentialDeleteSchema = z.object({
  ids: bulkCredentialIdsSchema,
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

function metaWithoutStaleTest(meta: unknown): Record<string, unknown> {
  const previous = meta && typeof meta === "object" ? { ...(meta as Record<string, unknown>) } : {};
  delete previous.lastTest;
  delete previous.discoveredModels;
  return previous;
}

function resolveTestProtocol(
  supportedProtocols: RelayProtocol[] | null | undefined,
  preferred?: RelayProtocol,
): RelayProtocol {
  const supported = supportedProtocols ?? [];
  if (supported.length === 0) {
    throw new Error("该渠道未声明任何支持协议");
  }

  if (preferred) {
    if (!supported.includes(preferred)) {
      throw new Error("该渠道未声明支持所选协议");
    }
    return preferred;
  }

  if (supported.includes("anthropic_messages")) return "anthropic_messages";
  if (supported.includes("openai_responses")) return "openai_responses";
  return supported.includes(DEFAULT_RELAY_PROTOCOL)
    ? DEFAULT_RELAY_PROTOCOL
    : supported[0];
}

async function testCredentialConnection(
  credentialId: number,
  preferredProtocol?: RelayProtocol,
): Promise<CredentialTestResult> {
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

  const protocol = resolveTestProtocol(credential.supportedProtocols, preferredProtocol);
  const testedAt = new Date().toISOString();
  const startedAt = Date.now();
  let result: CredentialTestResult;

  try {
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
      protocol,
      message: response.ok
        ? models.length
          ? `连接成功（${protocol}），发现 ${models.length} 个模型`
          : `连接成功（${protocol}），上游未返回可识别的模型列表`
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
      protocol,
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
          secret: upstreamSecretSchema,
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

        await tx.execute(
          sql`select pg_advisory_xact_lock(${productLine.id})`,
        );
        const existingRows = await tx
          .select({
            id: upstreamCredentials.id,
            secretEncrypted: upstreamCredentials.secretEncrypted,
          })
          .from(upstreamCredentials)
          .where(eq(upstreamCredentials.productLineId, productLine.id));
        const existingSecrets: string[] = [];
        const unreadableCredentialIds: number[] = [];
        for (const existing of existingRows) {
          try {
            existingSecrets.push(decryptSecret(existing.secretEncrypted));
          } catch {
            unreadableCredentialIds.push(existing.id);
          }
        }
        if (unreadableCredentialIds.length) {
          return {
            kind: "existing_secret_unreadable",
            credentialIds: unreadableCredentialIds,
          } as const;
        }
        if (
          inspectCredentialSecretDuplicates([body.data.secret], existingSecrets)
            .existingDuplicateIndexes.length
        ) {
          return { kind: "existing_duplicate" } as const;
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
          kind: "created",
          credential,
          provider: { id: provider.id, code: provider.code, name: provider.name },
          productLine: {
            id: productLine.id,
            code: productLine.code,
            name: productLine.name,
          },
          baseUrl: productLine.baseUrlOverride || provider.defaultBaseUrl,
        } as const;
      });

      if (created.kind === "existing_secret_unreadable") {
        return reply.code(409).send({
          success: false,
          message: "渠道中存在无法解密的旧 Key，无法安全完成重复检查",
          credentialIds: created.credentialIds,
        });
      }
      if (created.kind === "existing_duplicate") {
        return reply.code(409).send({
          success: false,
          message: "渠道中已存在相同 Key",
        });
      }

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
            protocol: resolveTestProtocol(body.data.supportedProtocols),
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
          credential: created.credential,
          provider: created.provider,
          productLine: created.productLine,
          baseUrl: created.baseUrl,
          test,
        },
      };
    },
  );

  app.post(
    "/api/admin/credentials/bulk-create",
    { preHandler: [requireRoles("admin")] },
    async (req, reply) => {
      const body = bulkCredentialCreateSchema.safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({
          success: false,
          message: "批量创建参数无效",
          errors: body.error.flatten(),
        });
      }

      const requestedSecrets = body.data.keys.map((item) => item.secret);
      const batchDuplicates = inspectCredentialSecretDuplicates(requestedSecrets);
      if (batchDuplicates.batchDuplicateIndexes.length) {
        return reply.code(409).send({
          success: false,
          message: `批量导入中存在重复 Key（第 ${batchDuplicates.batchDuplicateIndexes.join("、")} 项）`,
          duplicateIndexes: batchDuplicates.batchDuplicateIndexes,
        });
      }

      const supportedProtocols =
        body.data.defaults?.supportedProtocols
        ?? body.data.supportedProtocols
        ?? [DEFAULT_RELAY_PROTOCOL];
      const weight = body.data.defaults?.weight ?? body.data.weight ?? 100;
      const priority = body.data.defaults?.priority ?? body.data.priority ?? 0;

      const template = body.data.providerCode
        ? getProviderTemplate(body.data.providerCode)
        : undefined;
      const baseUrlOption = template && body.data.baseUrl
        ? resolveTemplateBaseUrlOption(template, body.data.baseUrl)
        : undefined;

      if (body.data.productLineId === undefined && !template) {
        return reply.code(400).send({ success: false, message: "暂不支持该供应商" });
      }
      if (body.data.productLineId === undefined && !baseUrlOption) {
        return reply.code(400).send({
          success: false,
          message: "Base URL 必须选择该供应商的官方地址",
        });
      }

      const created = await db.transaction(async (tx) => {
        let context: BulkProductLineContext | null = null;

        if (body.data.productLineId !== undefined) {
          const [located] = await tx
            .select({ productLine: productLines, provider: providers })
            .from(productLines)
            .innerJoin(providers, eq(productLines.providerId, providers.id))
            .where(eq(productLines.id, body.data.productLineId))
            .limit(1);

          if (!located) return { kind: "product_line_not_found" } as const;
          context = {
            ...located,
            baseUrl: located.productLine.baseUrlOverride || located.provider.defaultBaseUrl,
          };
        } else {
          // The guards above make these values available in this locator branch.
          if (!template || !baseUrlOption) {
            throw new Error("渠道定位参数无效");
          }

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
              .onConflictDoNothing({ target: providers.code })
              .returning();

            if (!provider) {
              [provider] = await tx
                .select()
                .from(providers)
                .where(eq(providers.code, template.code))
                .limit(1);
            }
          }
          if (!provider) throw new Error("供应商创建失败");

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
              .onConflictDoNothing({
                target: [productLines.providerId, productLines.code],
              })
              .returning();

            if (!productLine) {
              [productLine] = await tx
                .select()
                .from(productLines)
                .where(
                  and(
                    eq(productLines.providerId, provider.id),
                    eq(productLines.code, baseUrlOption.productLineCode),
                  ),
                )
                .limit(1);
            }
          }
          if (!productLine) throw new Error("渠道创建失败");

          context = {
            provider,
            productLine,
            baseUrl: productLine.baseUrlOverride || provider.defaultBaseUrl,
          };
        }

        // Serialize imports for the same channel so concurrent batches cannot
        // both pass duplicate inspection before either inserts its rows.
        await tx.execute(
          sql`select pg_advisory_xact_lock(${context.productLine.id})`,
        );

        const existingRows = await tx
          .select({
            id: upstreamCredentials.id,
            secretEncrypted: upstreamCredentials.secretEncrypted,
          })
          .from(upstreamCredentials)
          .where(eq(upstreamCredentials.productLineId, context.productLine.id));

        const existingSecrets: string[] = [];
        const unreadableCredentialIds: number[] = [];
        for (const credential of existingRows) {
          try {
            existingSecrets.push(decryptSecret(credential.secretEncrypted));
          } catch {
            unreadableCredentialIds.push(credential.id);
          }
        }
        if (unreadableCredentialIds.length) {
          return {
            kind: "existing_secret_unreadable",
            credentialIds: unreadableCredentialIds,
          } as const;
        }

        const duplicates = inspectCredentialSecretDuplicates(
          requestedSecrets,
          existingSecrets,
        );
        if (duplicates.existingDuplicateIndexes.length) {
          return {
            kind: "existing_duplicates",
            duplicateIndexes: duplicates.existingDuplicateIndexes,
          } as const;
        }

        const finalCredentialCount = existingRows.length + body.data.keys.length;
        const labelWidth = String(finalCredentialCount).length;
        const providerTemplate = getProviderTemplate(context.provider.code);
        const credentials = await tx
          .insert(upstreamCredentials)
          .values(
            body.data.keys.map((item, index) => ({
              productLineId: context.productLine.id,
              label:
                item.label
                ?? `${context.productLine.name} Key ${String(existingRows.length + index + 1).padStart(labelWidth, "0")}`,
              secretEncrypted: encryptSecret(item.secret),
              secretSuffix: secretSuffix(item.secret),
              supportedProtocols,
              weight,
              priority,
              meta: {
                createdBy: "bulk_create",
                ...(providerTemplate ? { providerTemplate: providerTemplate.code } : {}),
              },
              status: "active" as const,
            })),
          )
          .returning({
            id: upstreamCredentials.id,
            productLineId: upstreamCredentials.productLineId,
            label: upstreamCredentials.label,
            secretSuffix: upstreamCredentials.secretSuffix,
            supportedProtocols: upstreamCredentials.supportedProtocols,
            weight: upstreamCredentials.weight,
            priority: upstreamCredentials.priority,
            status: upstreamCredentials.status,
            createdAt: upstreamCredentials.createdAt,
          });

        await tx.insert(opsAuditLogs).values({
          actorEmployeeId: req.employeeId ?? null,
          action: "credential.bulk_create",
          targetType: "product_line",
          targetId: String(context.productLine.id),
          detail: {
            providerCode: context.provider.code,
            productLineId: context.productLine.id,
            credentialIds: credentials.map((item) => item.id),
            labels: credentials.map((item) => item.label),
            secretSuffixes: credentials.map((item) => item.secretSuffix),
            count: credentials.length,
            supportedProtocols,
            weight,
            priority,
          },
          ip: req.ip,
        });

        return { kind: "created", context, credentials } as const;
      });

      if (created.kind === "product_line_not_found") {
        return reply.code(404).send({ success: false, message: "渠道不存在" });
      }
      if (created.kind === "existing_secret_unreadable") {
        return reply.code(409).send({
          success: false,
          message: "渠道中存在无法解密的旧 Key，无法安全完成重复检查",
          credentialIds: created.credentialIds,
        });
      }
      if (created.kind === "existing_duplicates") {
        return reply.code(409).send({
          success: false,
          message: `渠道中已存在相同 Key（第 ${created.duplicateIndexes.join("、")} 项）`,
          duplicateIndexes: created.duplicateIndexes,
        });
      }

      return {
        success: true,
        data: {
          provider: {
            id: created.context.provider.id,
            code: created.context.provider.code,
            name: created.context.provider.name,
          },
          productLine: {
            id: created.context.productLine.id,
            code: created.context.productLine.code,
            name: created.context.productLine.name,
            productType: created.context.productLine.productType,
            shareMode: created.context.productLine.shareMode,
            status: created.context.productLine.status,
            baseUrl: created.context.baseUrl,
          },
          credentials: created.credentials,
          defaults: { supportedProtocols, weight, priority },
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
        productLineName: productLines.name,
        productLineStatus: productLines.status,
        productType: productLines.productType,
        shareMode: productLines.shareMode,
        providerCode: providers.code,
        providerName: providers.name,
        providerStatus: providers.status,
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

    const credentialIds = rows.map((row) => row.id);
    const recentSince = new Date(Date.now() - RECENT_WINDOW_MS);
    const recentRows = credentialIds.length
      ? await db
        .select({
          credentialId: requestAudits.credentialId,
          recentSuccessCount: sql<number>`coalesce(sum(case when ${requestAudits.status} = 'success' then 1 else 0 end), 0)::int`,
          recentErrorCount: sql<number>`coalesce(sum(case when ${requestAudits.status} <> 'success' then 1 else 0 end), 0)::int`,
        })
        .from(requestAudits)
        .where(
          and(
            inArray(requestAudits.credentialId, credentialIds),
            gte(requestAudits.createdAt, recentSince),
          ),
        )
        .groupBy(requestAudits.credentialId)
      : [];

    const recentById = new Map(
      recentRows
        .filter((row): row is typeof row & { credentialId: number } => row.credentialId != null)
        .map((row) => [
          row.credentialId,
          {
            recentSuccessCount: Number(row.recentSuccessCount) || 0,
            recentErrorCount: Number(row.recentErrorCount) || 0,
          },
        ]),
    );

    return {
      success: true,
      data: rows.map((row) => ({
        ...row,
        recentWindowHours: 24,
        recentSuccessCount: recentById.get(row.id)?.recentSuccessCount ?? 0,
        recentErrorCount: recentById.get(row.id)?.recentErrorCount ?? 0,
      })),
    };
  });

  app.patch(
    "/api/admin/credentials/bulk-status",
    { preHandler: [requireRoles("admin")] },
    async (req, reply) => {
      const body = bulkCredentialStatusSchema.safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({
          success: false,
          message: "批量状态参数无效",
          errors: body.error.flatten(),
        });
      }

      const result = await db.transaction(async (tx) => {
        const existing = await tx
          .select({
            id: upstreamCredentials.id,
            label: upstreamCredentials.label,
            productLineId: upstreamCredentials.productLineId,
            status: upstreamCredentials.status,
          })
          .from(upstreamCredentials)
          .where(inArray(upstreamCredentials.id, body.data.ids))
          .for("update");

        const existingIds = new Set(existing.map((item) => item.id));
        const missingIds = body.data.ids.filter((id) => !existingIds.has(id));
        if (missingIds.length) {
          return { kind: "missing", missingIds } as const;
        }

        const updated = await tx
          .update(upstreamCredentials)
          .set({
            status: body.data.status,
            ...(body.data.status === "active"
              ? { coolUntil: null, lastError: null }
              : {}),
            updatedAt: new Date(),
          })
          .where(inArray(upstreamCredentials.id, body.data.ids))
          .returning({
            id: upstreamCredentials.id,
            productLineId: upstreamCredentials.productLineId,
            label: upstreamCredentials.label,
            status: upstreamCredentials.status,
            coolUntil: upstreamCredentials.coolUntil,
            lastError: upstreamCredentials.lastError,
            updatedAt: upstreamCredentials.updatedAt,
          });

        const updatedById = new Map(updated.map((item) => [item.id, item]));
        const changes = existing.map((item) => ({
          id: item.id,
          productLineId: item.productLineId,
          previousStatus: item.status,
          status: body.data.status,
        }));
        await tx.insert(opsAuditLogs).values({
          actorEmployeeId: req.employeeId ?? null,
          action: "credential.bulk_status",
          targetType: "upstream_credential_batch",
          detail: {
            status: body.data.status,
            count: updated.length,
            changes,
          },
          ip: req.ip,
        });

        return {
          kind: "updated",
          credentials: body.data.ids
            .map((id) => updatedById.get(id))
            .filter((item): item is (typeof updated)[number] => Boolean(item)),
          previous: existing,
        } as const;
      });

      if (result.kind === "missing") {
        return reply.code(404).send({
          success: false,
          message: "部分凭证不存在，未修改任何凭证",
          missingIds: result.missingIds,
        });
      }

      return {
        success: true,
        data: {
          count: result.credentials.length,
          credentials: result.credentials,
        },
      };
    },
  );

  app.post(
    "/api/admin/credentials/bulk-delete",
    { preHandler: [requireRoles("admin")] },
    async (req, reply) => {
      const body = bulkCredentialDeleteSchema.safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({
          success: false,
          message: "批量删除参数无效",
          errors: body.error.flatten(),
        });
      }

      const result = await db.transaction(async (tx) => {
        const existing = await tx
          .select({
            id: upstreamCredentials.id,
            label: upstreamCredentials.label,
            secretSuffix: upstreamCredentials.secretSuffix,
            productLineId: upstreamCredentials.productLineId,
          })
          .from(upstreamCredentials)
          .where(inArray(upstreamCredentials.id, body.data.ids))
          .for("update");

        const existingIds = new Set(existing.map((item) => item.id));
        const missingIds = body.data.ids.filter((id) => !existingIds.has(id));
        if (missingIds.length) {
          return { kind: "missing", missingIds } as const;
        }

        await tx
          .delete(credentialEmployeeGrants)
          .where(inArray(credentialEmployeeGrants.credentialId, body.data.ids));

        const deleted = await tx
          .delete(upstreamCredentials)
          .where(inArray(upstreamCredentials.id, body.data.ids))
          .returning({ id: upstreamCredentials.id });

        await tx.insert(opsAuditLogs).values({
          actorEmployeeId: req.employeeId ?? null,
          action: "credential.bulk_delete",
          targetType: "upstream_credential_batch",
          detail: {
            count: deleted.length,
            credentials: existing.map((item) => ({
              id: item.id,
              label: item.label,
              secretSuffix: item.secretSuffix,
              productLineId: item.productLineId,
            })),
          },
          ip: req.ip,
        });

        return { kind: "deleted", credentials: existing, deleted } as const;
      });

      if (result.kind === "missing") {
        return reply.code(404).send({
          success: false,
          message: "部分凭证不存在，未删除任何凭证",
          missingIds: result.missingIds,
        });
      }

      return {
        success: true,
        data: {
          count: result.deleted.length,
          ids: body.data.ids,
        },
      };
    },
  );

  app.post(
    "/api/admin/credentials",
    { preHandler: [requireRoles("admin")] },
    async (req, reply) => {
      const body = z
        .object({
          productLineId: z.number().int().positive(),
          label: z.string().min(1).max(200),
          secret: upstreamSecretSchema,
          supportedProtocols: supportedProtocolsSchema.default([DEFAULT_RELAY_PROTOCOL]),
          weight: z.number().int().min(0).max(10000).default(100),
          priority: z.number().int().default(0),
          meta: z.record(z.unknown()).optional(),
        })
        .safeParse(req.body);

      if (!body.success) {
        return reply.code(400).send({ success: false, message: "参数无效" });
      }

      const result = await db.transaction(async (tx) => {
        const [productLine] = await tx
          .select({ id: productLines.id })
          .from(productLines)
          .where(eq(productLines.id, body.data.productLineId))
          .limit(1);
        if (!productLine) return { kind: "product_line_not_found" } as const;

        await tx.execute(
          sql`select pg_advisory_xact_lock(${productLine.id})`,
        );
        const existingRows = await tx
          .select({
            id: upstreamCredentials.id,
            secretEncrypted: upstreamCredentials.secretEncrypted,
          })
          .from(upstreamCredentials)
          .where(eq(upstreamCredentials.productLineId, productLine.id));
        const existingSecrets: string[] = [];
        const unreadableCredentialIds: number[] = [];
        for (const existing of existingRows) {
          try {
            existingSecrets.push(decryptSecret(existing.secretEncrypted));
          } catch {
            unreadableCredentialIds.push(existing.id);
          }
        }
        if (unreadableCredentialIds.length) {
          return {
            kind: "existing_secret_unreadable",
            credentialIds: unreadableCredentialIds,
          } as const;
        }
        if (
          inspectCredentialSecretDuplicates([body.data.secret], existingSecrets)
            .existingDuplicateIndexes.length
        ) {
          return { kind: "existing_duplicate" } as const;
        }

        const [row] = await tx
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

        await tx.insert(opsAuditLogs).values({
          actorEmployeeId: req.employeeId ?? null,
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

        return { kind: "created", row } as const;
      });

      if (result.kind === "product_line_not_found") {
        return reply.code(400).send({ success: false, message: "产品线不存在" });
      }
      if (result.kind === "existing_secret_unreadable") {
        return reply.code(409).send({
          success: false,
          message: "渠道中存在无法解密的旧 Key，无法安全完成重复检查",
          credentialIds: result.credentialIds,
        });
      }
      if (result.kind === "existing_duplicate") {
        return reply.code(409).send({
          success: false,
          message: "渠道中已存在相同 Key",
        });
      }

      return { success: true, data: result.row };
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
          secret: upstreamSecretSchema.optional(),
          baseUrl: z.string().url().optional(),
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

      const result = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({
            id: upstreamCredentials.id,
            productLineId: upstreamCredentials.productLineId,
            secretEncrypted: upstreamCredentials.secretEncrypted,
            meta: upstreamCredentials.meta,
            providerId: providers.id,
            providerCode: providers.code,
            defaultBaseUrl: providers.defaultBaseUrl,
          })
          .from(upstreamCredentials)
          .innerJoin(productLines, eq(upstreamCredentials.productLineId, productLines.id))
          .innerJoin(providers, eq(productLines.providerId, providers.id))
          .where(eq(upstreamCredentials.id, params.data.id))
          .limit(1)
          .for("update");

        if (!existing) return { kind: "not_found" } as const;

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
        if (body.data.secret !== undefined) {
          patch.secretEncrypted = encryptSecret(body.data.secret);
          patch.secretSuffix = secretSuffix(body.data.secret);
        }

        const requiresDuplicateCheck =
          body.data.secret !== undefined || body.data.baseUrl !== undefined;
        let candidateSecret = body.data.secret;
        if (requiresDuplicateCheck && candidateSecret === undefined) {
          try {
            candidateSecret = decryptSecret(existing.secretEncrypted);
          } catch {
            return { kind: "current_secret_unreadable" } as const;
          }
        }

        let targetProductLineId = existing.productLineId;
        let resolvedBaseUrl: string | undefined;
        if (body.data.baseUrl !== undefined) {
          const template = getProviderTemplate(existing.providerCode);
          if (!template) return { kind: "unsupported_provider" } as const;

          const baseUrlOption = resolveTemplateBaseUrlOption(template, body.data.baseUrl);
          if (!baseUrlOption) return { kind: "invalid_base_url" } as const;

          let [targetProductLine] = await tx
            .select()
            .from(productLines)
            .where(
              and(
                eq(productLines.providerId, existing.providerId),
                eq(productLines.code, baseUrlOption.productLineCode),
              ),
            )
            .limit(1);
          if (!targetProductLine) {
            [targetProductLine] = await tx
              .insert(productLines)
              .values({
                providerId: existing.providerId,
                code: baseUrlOption.productLineCode,
                name: baseUrlOption.productLineName,
                productType: "api",
                baseUrlOverride:
                  baseUrlOption.url === existing.defaultBaseUrl ? null : baseUrlOption.url,
                shareMode: "public_pool",
                allowAutoRoute: true,
                status: "active",
              })
              .onConflictDoNothing({
                target: [productLines.providerId, productLines.code],
              })
              .returning();
            if (!targetProductLine) {
              [targetProductLine] = await tx
                .select()
                .from(productLines)
                .where(
                  and(
                    eq(productLines.providerId, existing.providerId),
                    eq(productLines.code, baseUrlOption.productLineCode),
                  ),
                )
                .limit(1);
            }
          }
          if (!targetProductLine) throw new Error("渠道创建失败");

          targetProductLineId = targetProductLine.id;
          resolvedBaseUrl = baseUrlOption.url;
          if (targetProductLineId !== existing.productLineId) {
            patch.productLineId = targetProductLineId;
            // Endpoint changed: previous connectivity results no longer apply.
            if (body.data.meta === undefined) {
              patch.meta = metaWithoutStaleTest(existing.meta);
            }
          }
        }

        if (requiresDuplicateCheck) {
          if (candidateSecret === undefined) throw new Error("凭证去重参数无效");
          await tx.execute(
            sql`select pg_advisory_xact_lock(${targetProductLineId})`,
          );
          const targetCredentials = await tx
            .select({
              id: upstreamCredentials.id,
              secretEncrypted: upstreamCredentials.secretEncrypted,
            })
            .from(upstreamCredentials)
            .where(
              and(
                eq(upstreamCredentials.productLineId, targetProductLineId),
                ne(upstreamCredentials.id, existing.id),
              ),
            );
          const targetSecrets: string[] = [];
          const unreadableCredentialIds: number[] = [];
          for (const credential of targetCredentials) {
            try {
              targetSecrets.push(decryptSecret(credential.secretEncrypted));
            } catch {
              unreadableCredentialIds.push(credential.id);
            }
          }
          if (unreadableCredentialIds.length) {
            return {
              kind: "existing_secret_unreadable",
              credentialIds: unreadableCredentialIds,
            } as const;
          }
          if (
            inspectCredentialSecretDuplicates([candidateSecret], targetSecrets)
              .existingDuplicateIndexes.length
          ) {
            return { kind: "existing_duplicate" } as const;
          }
        }

        const [row] = await tx
          .update(upstreamCredentials)
          .set(patch)
          .where(eq(upstreamCredentials.id, existing.id))
          .returning({
            id: upstreamCredentials.id,
            label: upstreamCredentials.label,
            status: upstreamCredentials.status,
            secretSuffix: upstreamCredentials.secretSuffix,
            supportedProtocols: upstreamCredentials.supportedProtocols,
            productLineId: upstreamCredentials.productLineId,
          });
        if (!row) return { kind: "not_found" } as const;

        await tx.insert(opsAuditLogs).values({
          actorEmployeeId: req.employeeId ?? null,
          action: "credential.update",
          targetType: "upstream_credential",
          targetId: String(row.id),
          detail: {
            ...body.data,
            secret: body.data.secret ? "[updated]" : undefined,
            baseUrl: resolvedBaseUrl ?? body.data.baseUrl,
            productLineId: row.productLineId,
          },
          ip: req.ip,
        });

        return { kind: "updated", row } as const;
      });

      if (result.kind === "not_found") {
        return reply.code(404).send({ success: false, message: "凭证不存在" });
      }
      if (result.kind === "unsupported_provider") {
        return reply.code(400).send({
          success: false,
          message: "当前渠道平台不支持修改 API 地址",
        });
      }
      if (result.kind === "invalid_base_url") {
        return reply.code(400).send({
          success: false,
          message: "Base URL 必须选择该供应商的官方地址",
        });
      }
      if (result.kind === "current_secret_unreadable") {
        return reply.code(409).send({
          success: false,
          message: "当前 Key 无法解密，不能安全移动到其他渠道",
        });
      }
      if (result.kind === "existing_secret_unreadable") {
        return reply.code(409).send({
          success: false,
          message: "目标渠道中存在无法解密的旧 Key，无法安全完成重复检查",
          credentialIds: result.credentialIds,
        });
      }
      if (result.kind === "existing_duplicate") {
        return reply.code(409).send({
          success: false,
          message: "目标渠道中已存在相同 Key",
        });
      }

      return { success: true, data: result.row };
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
      const body = z
        .object({
          protocol: z.enum(RELAY_PROTOCOLS).optional(),
        })
        .safeParse(req.body ?? {});
      if (!params.success || !body.success) {
        return reply.code(400).send({ success: false, message: "参数无效" });
      }

      try {
        const result = await testCredentialConnection(params.data.id, body.data.protocol);
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
            protocol: result.protocol,
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

  // Coding plan style grants — read allowed for auditor; write remains admin-only.
  app.get("/api/admin/credentials/:id/grants", async (req, reply) => {
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
  });

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
