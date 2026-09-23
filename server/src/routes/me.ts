import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, desc, eq, gt, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { env } from "../config.js";
import { db } from "../db/client.js";
import {
  channelSeats,
  employeeApiKeys,
  employees,
  enterprises,
  opsAuditLogs,
  departments,
  productLines,
  providers,
  teamMembers,
  teams,
  requestAudits,
  upstreamCredentials,
  usageCountersDaily,
} from "../db/schema/index.js";
import {
  addCalendarDays,
  hasTimePart,
  parseDateOnly,
  quotaDayAt,
  zonedInstant,
  zonedMonthRange,
  zonedDayStart,
} from "../lib/quota-time.js";
import { listEmployeeTeamUsageViews } from "../lib/team-quota.js";
import {
  decryptEmployeeApiKey,
  encryptEmployeeApiKey,
  generateApiKey,
} from "../lib/api-key.js";
import {
  DEFAULT_RELAY_PROTOCOL,
  RELAY_PROTOCOLS,
  type RelayProtocol,
} from "../lib/relay/protocol.js";
import { catalogModelTags, groupDiscoveredModelsByChannel } from "../lib/discovered-models.js";
import { catalogModelsForProvider } from "../lib/relay/client-model.js";
import {
  isEmployeeSubmittedCredentialMeta,
  issueEmployeeSubmitTestProof,
  planEmployeeChannelCredentialSubmit,
  presentEmployeeSubmittedCredentials,
  verifyEmployeeSubmitTestProof,
} from "../lib/channel-credential-submit.js";
import {
  collectSubmitableSeats,
  SEAT_ALREADY_SUBMITTED_MESSAGE,
  SEAT_REQUIRED_MESSAGE,
} from "../lib/channel-seats.js";
import type { CredentialStatus } from "../lib/credential-status.js";
import { decryptSecret, encryptSecret, secretSuffix } from "../lib/crypto-secret.js";
import {
  probeUpstreamModels,
  resolveUpstreamTestProtocol,
} from "../lib/upstream-connection-test.js";
import {
  getEmployeeUpstreamChannel,
  getEmployeeUpstreamChannels,
} from "../lib/upstream-channel-metadata.js";
import {
  loadRelayPool,
  pooledProductLineDisplayName,
} from "../lib/relay/channel-pool.js";
import {
  configuredProtocols,
  parseProductLineProtocolConfigs,
  resolveProtocolUpstreamConfig,
} from "../lib/upstream-protocol-config.js";
import { actingEmployeeId } from "../lib/act-as.js";
import { loadSelectedUser } from "./admin/user-analytics.js";
import { departmentPathLabel } from "../lib/department-tree.js";
import { resolveEmployeeApiKeyTeam } from "../lib/org.js";
import {
  requireRoles,
  requireSession,
} from "../middleware/auth.js";

const createApiKeySchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    departmentId: z.number().int().positive().optional(),
    teamId: z.number().int().positive().optional(),
    productLineId: z.number().int().positive().optional(),
    protocol: z.enum(RELAY_PROTOCOLS).optional(),
  })
  .refine((data) => data.departmentId != null || data.teamId != null);

const submitUpstreamCredentialCoreSchema = z.object({
  seatId: z.number().int().positive(),
  secret: z
    .string()
    .trim()
    .min(8, "上游 Key 至少需要 8 个字符")
    .max(4096, "上游 Key 最多允许 4096 个字符"),
});

/**
 * `host` retains the client-facing port and, with Fastify's `trustProxy`, the
 * proxy-provided public host. Never derive this URL from the API listener port.
 */
export function buildRelayBaseUrl(
  request: Pick<FastifyRequest, "protocol" | "host">,
): string {
  return `${request.protocol}://${request.host}`;
}

function meId(req: FastifyRequest): number {
  return actingEmployeeId(req);
}

function noStore(reply: { header: (key: string, value: string) => unknown }) {
  reply.header("Cache-Control", "no-store");
  reply.header("Pragma", "no-cache");
}

/** 员工 Key 页面按明文展示，解密失败时返回 null，前端回退展示前缀。 */
function revealEmployeeApiKey(keyEncrypted: string): string | null {
  try {
    return decryptEmployeeApiKey(keyEncrypted);
  } catch {
    return null;
  }
}

const AUTO_KEY_NAME = "API Key";

async function loadOwnedSeat(employeeId: number, seatId: number) {
  const [seat] = await db
    .select({
      id: channelSeats.id,
      credentialId: channelSeats.credentialId,
      productLineId: channelSeats.productLineId,
      tag: channelSeats.tag,
    })
    .from(channelSeats)
    .where(
      and(
        eq(channelSeats.id, seatId),
        eq(channelSeats.employeeId, employeeId),
      ),
    )
    .limit(1);
  return seat ?? null;
}

/** 「模型列表」页的渠道+模型目录，/api/me/models 与 /api/me/log-models 共用。 */
async function meModelChannels(employeeId: number) {
  const accessible = await getEmployeeUpstreamChannels(employeeId);
  if (accessible.length === 0) {
    return [];
  }

  const productLineIds = [...new Set(accessible.flatMap((channel) => channel.memberProductLineIds))];
  const channelRows = await db
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
    .leftJoin(
      upstreamCredentials,
      and(
        eq(upstreamCredentials.productLineId, productLines.id),
        inArray(upstreamCredentials.status, ["active", "cooling"]),
        gt(upstreamCredentials.weight, 0),
      ),
    )
    .where(inArray(productLines.id, productLineIds));

  const groupedById = new Map(
    groupDiscoveredModelsByChannel(channelRows).map((channel) => [channel.id, channel]),
  );
  return accessible.map((channel) => {
    const catalog = catalogModelsForProvider(channel.providerCode);
    const models = catalog.length > 0
      ? catalog.map((item) => ({
          model: item.canonicalId,
          alias: item.alias,
          tags: catalogModelTags(item.upstreamModel),
        }))
      : [...new Set(
          channel.memberProductLineIds.flatMap((id) => groupedById.get(id)?.models ?? []),
        )]
          .sort((left, right) => left.localeCompare(right))
          .map((model) => ({
            model: `${channel.providerCode}/${model}`,
            alias: model,
            tags: catalogModelTags(model),
          }));
    return {
      id: channel.productLineId,
      name: channel.productLineName,
      code: channel.productLineCode,
      providerName: channel.providerName,
      providerCode: channel.providerCode,
      models,
    };
  });
}

/**
 * 日志筛选用的模型匹配集合：正式名与别称都算命中
 * （客户端两种写法都合法，审计里记录的是原始写法）。
 */
async function meLogModelVariants(employeeId: number, model: string): Promise<string[]> {
  const variants = new Set<string>([model]);
  for (const channel of await meModelChannels(employeeId)) {
    for (const item of channel.models) {
      const entry = typeof item === "string" ? { model: item, alias: null } : item;
      if (entry.model === model && entry.alias) variants.add(entry.alias);
      if (entry.alias === model) variants.add(entry.model);
    }
  }
  return [...variants];
}

export async function meRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requireRoles("employee", "dept_admin", "org_admin", "admin"));

  app.post("/api/me/enterprise-applications", async (_req, reply) => {
    return reply.code(403).send({
      success: false,
      message: "已关闭合作企业申请，请等待团队邀请",
    });
  });

  app.post("/api/me/join-enterprise", async (_req, reply) => {
    return reply.code(403).send({
      success: false,
      message: "不能自行加入企业，请等待团队管理员邀请",
    });
  });

  app.get("/api/me/org", async (req) => {
    const [me] = await db
      .select({
        enterpriseId: employees.enterpriseId,
      })
      .from(employees)
      .where(eq(employees.id, meId(req)))
      .limit(1);

    let enterprise: {
      id: number;
      name: string;
      code: string;
      status: string;
    } | null = null;
    if (me?.enterpriseId != null) {
      const [row] = await db
        .select({
          id: enterprises.id,
          name: enterprises.name,
          code: enterprises.code,
          status: enterprises.status,
        })
        .from(enterprises)
        .where(eq(enterprises.id, me.enterpriseId))
        .limit(1);
      enterprise = row ?? null;
    }

    const membershipRows = await db
      .select({
        id: teams.id,
        name: teams.name,
        status: teams.status,
        isDefault: teams.isDefault,
        departmentId: departments.id,
        departmentName: departments.name,
        departmentParentId: departments.parentId,
        departmentIsDefault: departments.isDefault,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .innerJoin(departments, eq(teams.departmentId, departments.id))
      .where(eq(teamMembers.employeeId, meId(req)))
      .orderBy(desc(teams.id));

    const departmentIds = [...new Set(membershipRows.map((row) => row.departmentId))];
    const treeRows = departmentIds.length
      ? await db
          .select({
            id: departments.id,
            parentId: departments.parentId,
            name: departments.name,
            isDefault: departments.isDefault,
          })
          .from(departments)
          .where(
            me?.enterpriseId != null
              ? eq(departments.enterpriseId, me.enterpriseId)
              : inArray(departments.id, departmentIds),
          )
      : [];

    const departmentById = new Map<number, (typeof membershipRows)[number]>();
    for (const row of membershipRows) {
      const current = departmentById.get(row.departmentId);
      if (!current || (row.isDefault && !current.isDefault)) {
        departmentById.set(row.departmentId, row);
      }
    }
    const departmentRows = [...departmentById.values()].map((row) => ({
      id: row.departmentId,
      name: row.departmentName,
      parentId: row.departmentParentId,
      isDefault: row.departmentIsDefault,
      teamId: row.id,
      path: departmentPathLabel({
        departmentId: row.departmentId,
        departments: treeRows,
        enterpriseName: enterprise?.name,
      }),
    }));

    return {
      success: true,
      data: {
        enterprise,
        departments: departmentRows,
        teams: membershipRows,
      },
    };
  });

  app.get("/api/me/upstream-channels", async (req) => {
    const channels = await getEmployeeUpstreamChannels(meId(req));
    return { success: true, data: channels };
  });

  app.get("/api/me/upstream-credential-channels", async (req) => {
    const rows = await db
      .select({
        id: productLines.id,
        name: productLines.name,
        code: productLines.code,
        productType: productLines.productType,
        status: productLines.status,
        providerCode: providers.code,
        providerName: providers.name,
        providerStatus: providers.status,
      })
      .from(productLines)
      .innerJoin(providers, eq(productLines.providerId, providers.id));
    const seats = await db
      .select({
        id: channelSeats.id,
        productLineId: channelSeats.productLineId,
        tag: channelSeats.tag,
        credentialId: channelSeats.credentialId,
      })
      .from(channelSeats)
      .where(eq(channelSeats.employeeId, meId(req)));

    return {
      success: true,
      data: collectSubmitableSeats(rows, seats),
    };
  });

  app.get("/api/me/upstream-credentials", async (req) => {
    const employeeId = meId(req);
    const rows = await db
      .select({
        id: upstreamCredentials.id,
        productLineId: productLines.id,
        productLineName: productLines.name,
        providerName: providers.name,
        providerCode: providers.code,
        label: upstreamCredentials.label,
        secretSuffix: upstreamCredentials.secretSuffix,
        status: upstreamCredentials.status,
        coolUntil: upstreamCredentials.coolUntil,
        createdAt: upstreamCredentials.createdAt,
      })
      .from(upstreamCredentials)
      .innerJoin(productLines, eq(upstreamCredentials.productLineId, productLines.id))
      .innerJoin(providers, eq(productLines.providerId, providers.id))
      .where(
        sql`${upstreamCredentials.meta} @> ${JSON.stringify({
          createdBy: "employee_submit",
          submittedByEmployeeId: employeeId,
        })}::jsonb`,
      )
      .orderBy(desc(upstreamCredentials.id));

    return {
      success: true,
      data: presentEmployeeSubmittedCredentials(
        rows.map((row) => ({
          ...row,
          status: row.status as CredentialStatus,
        })),
      ),
    };
  });

  app.post("/api/me/upstream-credentials/test", async (req, reply) => {
    const body = submitUpstreamCredentialCoreSchema.safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send({
        success: false,
        message: "请选择席位并填写渠道 KEY",
      });
    }

    const seat = await loadOwnedSeat(meId(req), body.data.seatId);
    if (!seat) {
      return reply.code(403).send({
        success: false,
        code: "seat_required",
        message: SEAT_REQUIRED_MESSAGE,
      });
    }
    if (seat.credentialId != null) {
      return reply.code(409).send({
        success: false,
        message: SEAT_ALREADY_SUBMITTED_MESSAGE,
      });
    }

    const [located] = await db
      .select({
        productLine: productLines,
        provider: providers,
      })
      .from(productLines)
      .innerJoin(providers, eq(productLines.providerId, providers.id))
      .where(eq(productLines.id, seat.productLineId))
      .limit(1);
    if (
      !located
      || located.productLine.status !== "active"
      || located.provider.status !== "active"
    ) {
      return reply.code(404).send({
        success: false,
        code: "channel_unavailable",
        message: "渠道不存在或已停用",
      });
    }

    const protocols = configuredProtocols(
      parseProductLineProtocolConfigs(located.productLine.protocolConfigs),
    );
    let protocol;
    try {
      protocol = resolveUpstreamTestProtocol(protocols);
    } catch (error) {
      const message = error instanceof Error ? error.message : "渠道尚未配置支持协议";
      return reply.code(400).send({
        success: false,
        code: "CHANNEL_PROTOCOLS_UNSET",
        message: message === "该渠道未声明任何支持协议"
          ? "渠道尚未配置支持协议"
          : message,
      });
    }

    const upstreamConfig = resolveProtocolUpstreamConfig({
      protocol,
      protocolConfigs: located.productLine.protocolConfigs,
      legacyBaseUrl: located.productLine.baseUrlOverride || located.provider.defaultBaseUrl,
      legacyAuthStyle: located.provider.authStyle,
    });
    if (!upstreamConfig) {
      return reply.code(400).send({
        success: false,
        message: "该渠道缺少所选协议的端点配置",
      });
    }

    let result;
    try {
      result = await probeUpstreamModels({
        providerCode: located.provider.code,
        protocol,
        baseUrl: upstreamConfig.baseUrl,
        authStyle: upstreamConfig.authStyle,
        secret: body.data.secret,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "测试失败";
      return reply.code(400).send({ success: false, message });
    }

    const proof = result.ok
      ? issueEmployeeSubmitTestProof({
          employeeId: meId(req),
          productLineId: located.productLine.id,
          secret: body.data.secret,
          testedAt: result.testedAt,
          protocol: result.protocol,
        })
      : null;

    return {
      success: true,
      data: {
        ok: result.ok,
        testedAt: result.testedAt,
        latencyMs: result.latencyMs,
        httpStatus: result.httpStatus,
        modelCount: result.modelCount,
        message: result.message,
        protocol: result.protocol,
        proof,
      },
    };
  });

  app.post("/api/me/upstream-credentials", async (req, reply) => {
    const core = submitUpstreamCredentialCoreSchema.safeParse(req.body ?? {});
    if (!core.success) {
      return reply.code(400).send({
        success: false,
        message: "请选择席位并填写渠道 KEY",
      });
    }
    const proofBody = z
      .object({
        testProof: z.string().trim().min(1).max(8192),
      })
      .safeParse(req.body ?? {});
    if (!proofBody.success) {
      return reply.code(400).send({
        success: false,
        message: "请先测试渠道 KEY，测试通过后再提交",
      });
    }

    const employeeId = meId(req);
    const ownedSeat = await loadOwnedSeat(employeeId, core.data.seatId);
    if (!ownedSeat) {
      return reply.code(403).send({
        success: false,
        code: "seat_required",
        message: SEAT_REQUIRED_MESSAGE,
      });
    }
    const proof = verifyEmployeeSubmitTestProof({
      proof: proofBody.data.testProof,
      employeeId,
      productLineId: ownedSeat.productLineId,
      secret: core.data.secret,
    });
    if (proof.kind === "expired") {
      return reply.code(400).send({
        success: false,
        message: "测试已过期，请重新测试",
      });
    }
    if (proof.kind !== "ok") {
      return reply.code(400).send({
        success: false,
        message: "请先测试渠道 KEY，测试通过后再提交",
      });
    }

    const employeeName = req.session?.name ?? "员工";
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${ownedSeat.productLineId})`);
      const [seat] = await tx
        .select({
          id: channelSeats.id,
          credentialId: channelSeats.credentialId,
          productLineId: channelSeats.productLineId,
        })
        .from(channelSeats)
        .where(
          and(
            eq(channelSeats.id, core.data.seatId),
            eq(channelSeats.employeeId, employeeId),
          ),
        )
        .limit(1)
        .for("update");
      if (!seat) return { kind: "seat_required" } as const;
      if (seat.credentialId != null) return { kind: "already_submitted" } as const;

      const [located] = await tx
        .select({
          productLine: productLines,
          provider: providers,
        })
        .from(productLines)
        .innerJoin(providers, eq(productLines.providerId, providers.id))
        .where(eq(productLines.id, seat.productLineId))
        .limit(1);
      if (!located) return { kind: "channel_unavailable" } as const;

      const existingRows = await tx
        .select({
          id: upstreamCredentials.id,
          secretEncrypted: upstreamCredentials.secretEncrypted,
          supportedProtocols: upstreamCredentials.supportedProtocols,
        })
        .from(upstreamCredentials)
        .where(eq(upstreamCredentials.productLineId, located.productLine.id));

      const existingSecrets: string[] = [];
      const unreadableCredentialIds: number[] = [];
      for (const row of existingRows) {
        try {
          existingSecrets.push(decryptSecret(row.secretEncrypted));
        } catch {
          unreadableCredentialIds.push(row.id);
        }
      }

      const plan = planEmployeeChannelCredentialSubmit({
        productLineStatus: located.productLine.status,
        providerStatus: located.provider.status,
        channelName: located.productLine.name,
        employeeName,
        protocolConfigs: located.productLine.protocolConfigs,
        existingCredentials: existingRows,
        existingSecrets,
        unreadableCredentialIds,
        secret: core.data.secret,
      });
      if (plan.kind !== "accepted") return plan;

      const [credential] = await tx
        .insert(upstreamCredentials)
        .values({
          productLineId: located.productLine.id,
          label: plan.label,
          secretEncrypted: encryptSecret(core.data.secret),
          secretSuffix: secretSuffix(core.data.secret),
          supportedProtocols: plan.protocols,
          weight: 100,
          priority: 0,
          meta: {
            createdBy: "employee_submit",
            submittedByEmployeeId: employeeId,
            lastTest: {
              ok: true,
              testedAt: proof.testedAt,
              protocol: proof.protocol,
              message: "提交前测试通过",
            },
          },
          status: "active",
        })
        .returning({
          id: upstreamCredentials.id,
          productLineId: upstreamCredentials.productLineId,
          label: upstreamCredentials.label,
          secretSuffix: upstreamCredentials.secretSuffix,
          status: upstreamCredentials.status,
        });

      await tx.insert(opsAuditLogs).values({
        actorEmployeeId: employeeId,
        action: "credential.employee_submit",
        targetType: "upstream_credential",
        targetId: String(credential.id),
        detail: {
          productLineId: located.productLine.id,
          productLineName: located.productLine.name,
          providerCode: located.provider.code,
          label: credential.label,
          secretSuffix: credential.secretSuffix,
        },
        ip: req.ip,
      });

      await tx
        .update(channelSeats)
        .set({ credentialId: credential.id, updatedAt: new Date() })
        .where(eq(channelSeats.id, seat.id));

      return { kind: "created" as const, credential };
    });

    if (result.kind === "seat_required") {
      return reply.code(403).send({
        success: false,
        code: "seat_required",
        message: SEAT_REQUIRED_MESSAGE,
      });
    }
    if (result.kind === "already_submitted") {
      return reply.code(409).send({
        success: false,
        message: SEAT_ALREADY_SUBMITTED_MESSAGE,
      });
    }
    if (result.kind === "channel_unavailable") {
      return reply.code(404).send({
        success: false,
        code: "channel_unavailable",
        message: "渠道不存在或已停用",
      });
    }
    if (result.kind === "channel_protocol_unset") {
      return reply.code(400).send({
        success: false,
        code: "CHANNEL_PROTOCOLS_UNSET",
        message: "渠道尚未配置支持协议",
      });
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
        message: "该渠道中已存在相同 Key",
      });
    }

    return { success: true, data: result.credential };
  });

  app.delete("/api/me/upstream-credentials/:id", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const employeeId = meId(req);
    const deleted = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: upstreamCredentials.id,
          label: upstreamCredentials.label,
          secretSuffix: upstreamCredentials.secretSuffix,
          productLineId: upstreamCredentials.productLineId,
          meta: upstreamCredentials.meta,
        })
        .from(upstreamCredentials)
        .where(eq(upstreamCredentials.id, params.data.id))
        .limit(1)
        .for("update");
      if (!row || !isEmployeeSubmittedCredentialMeta(row.meta, employeeId)) {
        return null;
      }

      await tx.delete(upstreamCredentials).where(eq(upstreamCredentials.id, row.id));
      await tx.insert(opsAuditLogs).values({
        actorEmployeeId: employeeId,
        action: "credential.delete",
        targetType: "upstream_credential",
        targetId: String(row.id),
        detail: {
          productLineId: row.productLineId,
          label: row.label,
          secretSuffix: row.secretSuffix,
          createdBy: "employee_submit",
        },
        ip: req.ip,
      });
      return row;
    });

    if (!deleted) {
      return reply.code(404).send({
        success: false,
        message: "提交记录不存在",
      });
    }

    return { success: true, data: { id: deleted.id } };
  });

  app.get("/api/me/models", async (req) => ({
    success: true,
    data: { channels: await meModelChannels(meId(req)) },
  }));

  app.get("/api/me/api-keys", async (req, reply) => {
    noStore(reply);
    const rows = await db
      .select({
        id: employeeApiKeys.id,
        name: employeeApiKeys.name,
        keyPrefix: employeeApiKeys.keyPrefix,
        keyEncrypted: employeeApiKeys.keyEncrypted,
        protocol: employeeApiKeys.protocol,
        productLineId: employeeApiKeys.productLineId,
        teamId: employeeApiKeys.teamId,
        teamName: teams.name,
        departmentId: teams.departmentId,
        departmentName: departments.name,
        productLineName: productLines.name,
        relayPoolKey: productLines.relayPoolKey,
        providerCode: providers.code,
        providerName: providers.name,
        status: employeeApiKeys.status,
        lastUsedAt: employeeApiKeys.lastUsedAt,
        createdAt: employeeApiKeys.createdAt,
      })
      .from(employeeApiKeys)
      .innerJoin(productLines, eq(employeeApiKeys.productLineId, productLines.id))
      .innerJoin(providers, eq(productLines.providerId, providers.id))
      .leftJoin(teams, eq(employeeApiKeys.teamId, teams.id))
      .leftJoin(departments, eq(teams.departmentId, departments.id))
      .where(eq(employeeApiKeys.employeeId, meId(req)))
      .orderBy(desc(employeeApiKeys.id));

    return {
      success: true,
      data: rows.map(({ relayPoolKey, keyEncrypted, ...row }) => ({
        ...row,
        key: revealEmployeeApiKey(keyEncrypted),
        productLineName: pooledProductLineDisplayName({
          relayPoolKey,
          productLineName: row.productLineName,
        }),
      })),
    };
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
      // employee -> admin transition could insert a new active Key
      // after the transition transaction had already revoked the old ones.
      const [owner] = await tx
        .select({
          role: employees.role,
          status: employees.status,
          enterpriseId: employees.enterpriseId,
        })
        .from(employees)
        .where(eq(employees.id, meId(req)))
        .limit(1)
        .for("update");

      if (
        !owner ||
        (owner.role !== "employee" &&
          owner.role !== "dept_admin" &&
          owner.role !== "org_admin") ||
        owner.status !== "active"
      ) {
        return { outcome: "forbidden" } as const;
      }
      if (owner.enterpriseId == null) {
        return { outcome: "no_enterprise" } as const;
      }

      const membershipRows = await tx
        .select({
          teamId: teams.id,
          departmentId: teams.departmentId,
          departmentName: departments.name,
          isDefault: teams.isDefault,
          status: teams.status,
        })
        .from(teamMembers)
        .innerJoin(teams, eq(teamMembers.teamId, teams.id))
        .innerJoin(departments, eq(teams.departmentId, departments.id))
        .where(eq(teamMembers.employeeId, meId(req)));
      const membership = resolveEmployeeApiKeyTeam({
        memberships: membershipRows,
        departmentId: body.data.departmentId,
        teamId: body.data.teamId,
      });
      if (!membership) {
        return {
          outcome: membershipRows.filter((row) => row.status === "active").length > 1
            ? "department_required"
            : "no_team",
        } as const;
      }

      const protocol = body.data.protocol ?? DEFAULT_RELAY_PROTOCOL;
      let channel: Awaited<ReturnType<typeof getEmployeeUpstreamChannel>> = null;
      if (body.data.productLineId != null) {
        const pool = await loadRelayPool(body.data.productLineId, tx);
        if (!pool) {
          return { outcome: "channel_unavailable" } as const;
        }
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${pool.key}))`,
        );
        channel = await getEmployeeUpstreamChannel(
          meId(req),
          body.data.productLineId,
          tx,
          { lockForCreate: true },
        );
      } else {
        const preview = await getEmployeeUpstreamChannels(meId(req), tx);
        if (preview.length === 0) {
          return { outcome: "channel_unavailable" } as const;
        }
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${preview[0].relayPoolKey}))`,
        );
        const channels = await getEmployeeUpstreamChannels(meId(req), tx, {
          lockForCreate: true,
        });
        channel = channels[0] ?? null;
      }
      if (!channel) {
        return { outcome: "channel_unavailable" } as const;
      }
      if (
        body.data.protocol != null &&
        !channel.compatibleProtocols.includes(body.data.protocol)
      ) {
        return { outcome: "protocol_incompatible" } as const;
      }

      const [created] = await tx
        .insert(employeeApiKeys)
        .values({
          employeeId: meId(req),
          name: body.data.name,
          keyPrefix: prefix,
          keyHash: hash,
          keyEncrypted,
          protocol,
          productLineId: channel.productLineId,
          teamId: membership.teamId,
        })
        .returning({
          id: employeeApiKeys.id,
          name: employeeApiKeys.name,
          keyPrefix: employeeApiKeys.keyPrefix,
          protocol: employeeApiKeys.protocol,
          productLineId: employeeApiKeys.productLineId,
          teamId: employeeApiKeys.teamId,
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
          teamId: created.teamId,
          departmentId: membership.departmentId,
          departmentName: membership.departmentName,
        },
        ip: req.ip,
      });

      return {
        outcome: "created",
        row: created,
        channel,
        departmentId: membership.departmentId,
        departmentName: membership.departmentName,
      } as const;
    });

    if (result.outcome === "forbidden") {
      return reply.code(403).send({
        success: false,
        code: "forbidden",
        message: "权限不足",
      });
    }
    if (result.outcome === "no_enterprise") {
      return reply.code(403).send({
        success: false,
        code: "enterprise_required",
        message: "未加入企业，暂无 Token 额度",
      });
    }
    if (result.outcome === "no_team") {
      return reply.code(403).send({
        success: false,
        code: "team_required",
        message: "请先加入部门后再创建 API Key",
      });
    }
    if (result.outcome === "department_required") {
      return reply.code(400).send({
        success: false,
        code: "department_required",
        message: "加入了多个部门，请选择要绑定的部门",
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
    if (result.outcome !== "created") {
      return reply.code(500).send({
        success: false,
        code: "create_failed",
        message: "创建 API Key 失败",
      });
    }

    return {
      success: true,
      data: {
        ...result.row,
        departmentId: result.departmentId,
        departmentName: result.departmentName,
        productLineName: result.channel.productLineName,
        providerCode: result.channel.providerCode,
        providerName: result.channel.providerName,
        key: raw,
      },
    };
  });

  /**
   * 自动补齐：为员工的每个部门 × 每个协议确保一把可用 Key，缺则创建。
   * 已有该（部门默认团队, 协议）组合的 active Key 时跳过，幂等可重复调用。
   */
  app.post("/api/me/api-keys/provision", async (req, reply) => {
    noStore(reply);

    const result = await db.transaction(async (tx) => {
      // 与手动创建保持同一把员工行锁，避免与管理员角色变更并发。
      const [owner] = await tx
        .select({
          role: employees.role,
          status: employees.status,
          enterpriseId: employees.enterpriseId,
        })
        .from(employees)
        .where(eq(employees.id, meId(req)))
        .limit(1)
        .for("update");

      if (
        !owner ||
        (owner.role !== "employee" &&
          owner.role !== "dept_admin" &&
          owner.role !== "org_admin") ||
        owner.status !== "active"
      ) {
        return { outcome: "forbidden" } as const;
      }
      if (owner.enterpriseId == null) {
        return { outcome: "no_enterprise" } as const;
      }

      const membershipRows = await tx
        .select({
          teamId: teams.id,
          departmentId: teams.departmentId,
          departmentName: departments.name,
          isDefault: teams.isDefault,
          status: teams.status,
        })
        .from(teamMembers)
        .innerJoin(teams, eq(teamMembers.teamId, teams.id))
        .innerJoin(departments, eq(teams.departmentId, departments.id))
        .where(eq(teamMembers.employeeId, meId(req)));

      // 每个部门取一个团队（优先默认团队），与 resolveEmployeeApiKeyTeam 的选择一致。
      const departmentTeams = new Map<number, (typeof membershipRows)[number]>();
      for (const row of membershipRows) {
        if (row.status !== "active") continue;
        const current = departmentTeams.get(row.departmentId);
        if (!current || (row.isDefault && !current.isDefault)) {
          departmentTeams.set(row.departmentId, row);
        }
      }
      if (departmentTeams.size === 0) {
        return { outcome: "no_team" } as const;
      }

      const previewChannels = await getEmployeeUpstreamChannels(meId(req), tx);
      const poolKeys = [...new Set(previewChannels.map((channel) => channel.relayPoolKey))]
        .sort();
      for (const poolKey of poolKeys) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${poolKey}))`);
      }
      const channels = await getEmployeeUpstreamChannels(meId(req), tx, {
        lockForCreate: true,
      });
      if (channels.length === 0) {
        return { outcome: "channel_unavailable" } as const;
      }

      const existingRows = await tx
        .select({
          teamId: employeeApiKeys.teamId,
        })
        .from(employeeApiKeys)
        .where(
          and(
            eq(employeeApiKeys.employeeId, meId(req)),
            eq(employeeApiKeys.status, "active"),
          ),
        );
      const existing = new Set(
        existingRows.map((row) => String(row.teamId)),
      );

      const created: {
        id: number;
        name: string;
        key: string;
        keyPrefix: string;
        protocol: RelayProtocol;
        productLineId: number;
        productLineName: string;
        providerCode: string;
        providerName: string;
        teamId: number;
        departmentId: number;
        departmentName: string;
      }[] = [];

      const memberships = [...departmentTeams.values()]
        .sort((left, right) => left.departmentId - right.departmentId);
      for (const membership of memberships) {
        if (existing.has(String(membership.teamId))) continue;
        const channel = channels[0];
        if (!channel) continue;

        const { raw, prefix, hash } = generateApiKey();
        const [row] = await tx
          .insert(employeeApiKeys)
          .values({
            employeeId: meId(req),
            name: AUTO_KEY_NAME,
            keyPrefix: prefix,
            keyHash: hash,
            keyEncrypted: encryptEmployeeApiKey(raw),
            protocol: DEFAULT_RELAY_PROTOCOL,
            productLineId: channel.productLineId,
            teamId: membership.teamId,
          })
          .returning({
            id: employeeApiKeys.id,
            name: employeeApiKeys.name,
            keyPrefix: employeeApiKeys.keyPrefix,
            protocol: employeeApiKeys.protocol,
            productLineId: employeeApiKeys.productLineId,
            teamId: employeeApiKeys.teamId,
          });

        await tx.insert(opsAuditLogs).values({
          actorEmployeeId: req.employeeId,
          action: "api_key.create",
          targetType: "employee_api_key",
          targetId: String(row.id),
          detail: {
            productLineId: row.productLineId,
            productLineName: channel.productLineName,
            providerCode: channel.providerCode,
            providerName: channel.providerName,
            protocol: row.protocol,
            teamId: row.teamId,
            departmentId: membership.departmentId,
            departmentName: membership.departmentName,
            autoProvisioned: true,
          },
          ip: req.ip,
        });

        existing.add(String(membership.teamId));
        created.push({
          ...row,
          teamId: membership.teamId,
          key: raw,
          productLineName: channel.productLineName,
          providerCode: channel.providerCode,
          providerName: channel.providerName,
          departmentId: membership.departmentId,
          departmentName: membership.departmentName,
        });
      }

      return { outcome: "provisioned", created } as const;
    });

    if (result.outcome === "forbidden") {
      return reply.code(403).send({
        success: false,
        code: "forbidden",
        message: "权限不足",
      });
    }
    if (result.outcome === "no_enterprise") {
      return reply.code(403).send({
        success: false,
        code: "enterprise_required",
        message: "未加入企业，暂无 Token 额度",
      });
    }
    if (result.outcome === "no_team") {
      return { success: true, data: { created: [] } };
    }
    if (result.outcome === "channel_unavailable") {
      return reply.code(404).send({
        success: false,
        code: "upstream_channel_unavailable",
        message: "暂无可用上游渠道，请联系管理员配置",
      });
    }

    return { success: true, data: { created: result.created } };
  });

  /** 更新 Key：原位换发新密钥，绑定（部门/协议/渠道）不变，旧 Key 立即失效。 */
  app.post("/api/me/api-keys/:id/regenerate", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    noStore(reply);

    const result = await db.transaction(async (tx) => {
      // 与创建/补齐同一把员工行锁，避免员工角色变更与换发并发。
      const [owner] = await tx
        .select({
          role: employees.role,
          status: employees.status,
        })
        .from(employees)
        .where(eq(employees.id, meId(req)))
        .limit(1)
        .for("update");
      if (
        !owner ||
        (owner.role !== "employee" &&
          owner.role !== "dept_admin" &&
          owner.role !== "org_admin") ||
        owner.status !== "active"
      ) {
        return { outcome: "forbidden" } as const;
      }

      const { raw, prefix, hash } = generateApiKey();
      const [row] = await tx
        .update(employeeApiKeys)
        .set({
          keyPrefix: prefix,
          keyHash: hash,
          keyEncrypted: encryptEmployeeApiKey(raw),
        })
        .where(
          and(
            eq(employeeApiKeys.id, params.data.id),
            eq(employeeApiKeys.employeeId, meId(req)),
          ),
        )
        .returning({
          id: employeeApiKeys.id,
          name: employeeApiKeys.name,
          keyPrefix: employeeApiKeys.keyPrefix,
          protocol: employeeApiKeys.protocol,
          productLineId: employeeApiKeys.productLineId,
          teamId: employeeApiKeys.teamId,
        });
      if (!row) return { outcome: "not_found" } as const;

      await tx.insert(opsAuditLogs).values({
        actorEmployeeId: req.employeeId,
        action: "api_key.regenerate",
        targetType: "employee_api_key",
        targetId: String(row.id),
        detail: {
          name: row.name,
          keyPrefix: row.keyPrefix,
          protocol: row.protocol,
          productLineId: row.productLineId,
          teamId: row.teamId,
        },
        ip: req.ip,
      });

      return { outcome: "regenerated", row, key: raw } as const;
    });

    if (result.outcome === "forbidden") {
      return reply.code(403).send({
        success: false,
        code: "forbidden",
        message: "权限不足",
      });
    }
    if (result.outcome === "not_found") {
      return reply.code(404).send({
        success: false,
        code: "api_key_not_found",
        message: "API Key 不存在或已删除",
      });
    }

    return { success: true, data: { ...result.row, key: result.key } };
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
            eq(employeeApiKeys.employeeId, meId(req)),
          ),
        )
        .limit(1);

      if (!target) return null;

      await tx
        .delete(employeeApiKeys)
        .where(
          and(
            eq(employeeApiKeys.id, target.id),
            eq(employeeApiKeys.employeeId, meId(req)),
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
    const today = quotaDayAt(new Date(), env.QUOTA_TIMEZONE);
    const monthStart = `${today.slice(0, 8)}01`;
    const [day] = await db
      .select()
      .from(usageCountersDaily)
      .where(
        and(
          eq(usageCountersDaily.employeeId, meId(req)),
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
          eq(usageCountersDaily.employeeId, meId(req)),
          sql`${usageCountersDaily.day} >= ${monthStart}`,
        ),
      );

    const [employee] = await db
      .select({
        enterpriseId: employees.enterpriseId,
        enterpriseName: enterprises.name,
        enterpriseCode: enterprises.code,
        enterpriseStatus: enterprises.status,
      })
      .from(employees)
      .leftJoin(enterprises, eq(employees.enterpriseId, enterprises.id))
      .where(eq(employees.id, meId(req)))
      .limit(1);
    const teamUsage = await listEmployeeTeamUsageViews(
      meId(req),
      today,
      zonedMonthRange(new Date(), env.QUOTA_TIMEZONE),
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
        membership: {
          enterpriseId: employee?.enterpriseId ?? null,
          enterpriseName: employee?.enterpriseName ?? null,
          enterpriseCode: employee?.enterpriseCode ?? null,
        },
        teams: teamUsage,
        relay: {
          baseUrl: buildRelayBaseUrl(req),
          note: "Authorization: Bearer <your employee API key>",
        },
      },
    };
  });

  // 个人版用户分析：复用管理端「用户分析」的 loadSelectedUser，固定查自己
  app.get("/api/me/analytics", async (req, reply) => {
    const today = quotaDayAt(new Date(), env.QUOTA_TIMEZONE);
    const query = z
      .object({ day: z.string().optional() })
      .safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const day = query.data.day?.trim() || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !parseDateOnly(day)) {
      return reply.code(400).send({ success: false, message: "日期无效" });
    }
    if (day > today) {
      return reply.code(400).send({ success: false, message: "日期不能晚于今天" });
    }

    const selected = await loadSelectedUser(meId(req), day);
    return {
      success: true,
      data: {
        day,
        timezone: env.QUOTA_TIMEZONE,
        selected,
      },
    };
  });

  // 模型筛选项：与「模型列表」页(/api/me/models)同源，列表里有多少就显示多少
  app.get("/api/me/log-models", async (req) => {
    const channels = await meModelChannels(meId(req));
    const byModel = new Map<string, { model: string; alias: string | null; variants: string[] }>();
    for (const channel of channels) {
      for (const item of channel.models) {
        const model = typeof item === "string" ? item : item.model;
        const alias = typeof item === "string" ? null : (item.alias ?? null);
        const entry = byModel.get(model) ?? { model, alias, variants: [model] };
        if (alias && !entry.variants.includes(alias)) entry.variants.push(alias);
        byModel.set(model, entry);
      }
    }
    const models = [...byModel.values()].sort((left, right) => left.model.localeCompare(right.model));
    return { success: true, data: { models } };
  });

  app.get("/api/me/logs", async (req, reply) => {
    const dateOrDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}:\d{2})?$/);
    const query = z
      .object({
        limit: z.coerce.number().min(1).max(100).default(20),
        offset: z.coerce.number().min(0).default(0),
        productLineId: z.coerce.number().int().positive().optional(),
        model: z.string().trim().min(1).max(128).optional(),
        status: z.enum(["success", "upstream_error", "client_error", "cancelled"]).optional(),
        from: dateOrDateTime.optional(),
        to: dateOrDateTime.optional(),
      })
      .safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const filters = query.data;
    // from/to 支持到秒：带时间部分的边界按精确时刻，纯日期按整天（含当天）
    let rangeStart: Date | null = null;
    let rangeEnd: Date | null = null;
    if (filters.from || filters.to) {
      const fromValue = filters.from ?? filters.to!;
      const toValue = filters.to ?? filters.from!;
      rangeStart = zonedInstant(fromValue, env.QUOTA_TIMEZONE);
      if (!rangeStart) {
        return reply.code(400).send({ success: false, message: "参数无效" });
      }
      rangeEnd = hasTimePart(toValue)
        ? zonedInstant(toValue, env.QUOTA_TIMEZONE)
        : zonedDayStart(addCalendarDays(toValue, 1), env.QUOTA_TIMEZONE);
      if (!rangeEnd || rangeStart.getTime() >= rangeEnd.getTime()) {
        return reply.code(400).send({ success: false, message: "参数无效" });
      }
    }

    const conditions: SQL[] = [eq(requestAudits.employeeId, meId(req))];
    if (filters.productLineId) conditions.push(eq(requestAudits.productLineId, filters.productLineId));
    if (filters.model) {
      const variants = await meLogModelVariants(meId(req), filters.model);
      conditions.push(inArray(requestAudits.clientModel, variants));
    }
    if (filters.status) conditions.push(eq(requestAudits.status, filters.status));
    if (rangeStart && rangeEnd) {
      conditions.push(gte(requestAudits.createdAt, rangeStart));
      conditions.push(lt(requestAudits.createdAt, rangeEnd));
    }
    const whereExpr = and(...conditions);
    const [[countRow], items] = await Promise.all([
      db.select({ total: sql<number>`count(*)::int` }).from(requestAudits).where(whereExpr),
      db
        .select({
          id: requestAudits.id,
          requestId: requestAudits.requestId,
          clientModel: requestAudits.clientModel,
          providerCode: requestAudits.providerCode,
          productType: requestAudits.productType,
          status: requestAudits.status,
          promptTokens: requestAudits.promptTokens,
          completionTokens: requestAudits.completionTokens,
          totalTokens: requestAudits.totalTokens,
          cacheReadTokens: requestAudits.cacheReadTokens,
          createdAt: requestAudits.createdAt,
        })
        .from(requestAudits)
        .where(whereExpr)
        .orderBy(desc(requestAudits.createdAt), desc(requestAudits.id))
        .limit(filters.limit)
        .offset(filters.offset),
    ]);

    return {
      success: true,
      data: {
        total: countRow?.total ?? 0,
        items,
      },
    };
  });
}
