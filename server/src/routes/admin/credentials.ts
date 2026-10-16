import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  channelSeats,
  credentialBindingMembers,
  credentialBindings,
  employees,
  enterprises,
  opsAuditLogs,
  productLines,
  providers,
  requestAudits,
  upstreamCredentials,
} from "../../db/schema/index.js";
import { env } from "../../config.js";
import { loadCredentialMembers, type CredentialMembership } from "../../lib/relay/binding.js";
import { effectiveKeyMaxMembers } from "../../lib/relay/key-limits.js";
import {
  FIVE_HOUR_MS,
  credentialWindowAnchors,
  effectiveWeeklyResetAt,
  fiveHourBaseCreditsBeforeSql,
  getCredentialQuotaUsage,
  packageCreditLimits,
  nextFiveHourResetAt,
  nextWeeklyResetAt,
  monthlyWindowBounds,
  type CredentialWindowAnchors,
} from "../../lib/relay/credential-quota.js";
import { resolveRelayRateLimitCooldown } from "../../lib/relay/upstream.js";
import { inspectCredentialSecretDuplicates } from "../../lib/credential-duplicates.js";
import {
  partitionCredentialSubmitRoster,
  presentEmployeeSubmittedCredentials,
  submittedByEmployeeIdFromMeta,
} from "../../lib/channel-credential-submit.js";
import {
  effectiveCredentialStatus,
  type CredentialStatus,
} from "../../lib/credential-status.js";
import { decryptSecret, encryptSecret, secretSuffix } from "../../lib/crypto-secret.js";
import {
  fetchZhipuTeamQuota,
  type QuotaWindow,
} from "../../lib/zhipu-team-quota.js";
import {
  officialCoolingTarget,
  QUOTA_CAP_KINDS,
  type QuotaCapKind,
} from "../../lib/official-quota-state.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import {
  probeUpstreamModels,
  resolveUpstreamTestProtocol,
  type UpstreamConnectionTestResult,
} from "../../lib/upstream-connection-test.js";
import {
  findChannelPlugin,
  resolveChannelVariant,
  resolveVariantProtocolConfigs,
  variantProtocols,
} from "../../channels/index.js";
import {
  RELAY_PROTOCOLS,
  type RelayProtocol,
} from "../../lib/relay/protocol.js";
import {
  configurableSupportedProtocolsSchema,
  resolveChannelCredentialInsertProtocols,
} from "../../lib/upstream-channel-update.js";
import {
  configuredProtocols,
  parseProductLineProtocolConfigs,
  planEmptyChannelProtocolConfigInitialization,
  resolveProtocolUpstreamConfig,
} from "../../lib/upstream-protocol-config.js";
import {
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

type CredentialTestResult = UpstreamConnectionTestResult;

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1_000;

const supportedProtocolsSchema = configurableSupportedProtocolsSchema;

/** 绑定只显示成员：挂着谁、几个人、每把最多几个人。 */
function membershipView(
  membership: CredentialMembership | undefined,
  memberLimit: number = env.RELAY_KEY_MAX_MEMBERS,
) {
  return {
    bound: membership?.bound ?? false,
    members: (membership?.members ?? []).map((member) => ({
      employeeId: member.employeeId,
      name: member.name,
    })),
    memberLimit,
  };
}

function pushUniqueName(names: string[], value: string | null | undefined) {
  const name = value?.trim();
  if (name && !names.includes(name)) names.push(name);
}

async function loadConnectedNamesByCredential(
  rows: ReadonlyArray<{ id: number; meta: unknown }>,
): Promise<Map<number, string[]>> {
  const connected = new Map<number, string[]>();
  if (rows.length === 0) return connected;
  const credentialIds = rows.map((row) => row.id);
  for (const id of credentialIds) connected.set(id, []);

  const memberRows = await db
    .select({
      credentialId: credentialBindings.credentialId,
      name: employees.name,
    })
    .from(credentialBindingMembers)
    .innerJoin(credentialBindings, eq(credentialBindings.id, credentialBindingMembers.bindingId))
    .innerJoin(employees, eq(employees.id, credentialBindingMembers.employeeId))
    .where(inArray(credentialBindings.credentialId, credentialIds));
  for (const row of memberRows) {
    pushUniqueName(connected.get(row.credentialId) ?? [], row.name);
  }

  const submitterIdByCredential = new Map<number, number>();
  for (const row of rows) {
    const employeeId = submittedByEmployeeIdFromMeta(row.meta);
    if (employeeId != null) submitterIdByCredential.set(row.id, employeeId);
  }
  const submitterIds = [...new Set(submitterIdByCredential.values())];
  if (submitterIds.length) {
    const people = await db
      .select({ id: employees.id, name: employees.name })
      .from(employees)
      .where(inArray(employees.id, submitterIds));
    const nameById = new Map(people.map((person) => [person.id, person.name]));
    for (const [credentialId, employeeId] of submitterIdByCredential) {
      pushUniqueName(connected.get(credentialId) ?? [], nameById.get(employeeId));
    }
  }
  return connected;
}

const upstreamSecretSchema = z
  .string()
  .trim()
  .min(8, "上游 Key 至少需要 8 个字符")
  .max(4096, "上游 Key 最多允许 4096 个字符");

function metaWithoutStaleTest(meta: unknown): Record<string, unknown> {
  const previous = meta && typeof meta === "object" ? { ...(meta as Record<string, unknown>) } : {};
  delete previous.lastTest;
  delete previous.discoveredModels;
  return previous;
}

type TemplateChannelProtocolInitializationResult =
  | { kind: "unchanged" | "initialized"; productLine: typeof productLines.$inferSelect }
  | { kind: "protocol_unsupported"; unsupportedProtocols: RelayProtocol[] }
  | { kind: "config_stale" };

/**
 * Initialise protocol-specific routing while the caller holds the channel's
 * advisory lock and has already taken a fresh product-line snapshot. Legacy
 * channels with credentials are intentionally left untouched.
 */
async function initializeEmptyTemplateChannelProtocolConfigs(
  tx: Pick<typeof db, "update">,
  input: {
    productLine: typeof productLines.$inferSelect;
    providerCode: string;
    credentialCount: number;
    requestedProtocols?: readonly RelayProtocol[];
    fallbackProtocols?: readonly RelayProtocol[];
    repairExplicitDrift: boolean;
  },
): Promise<TemplateChannelProtocolInitializationResult> {
  if (input.credentialCount !== 0) {
    return { kind: "unchanged", productLine: input.productLine };
  }

  const currentConfigs = parseProductLineProtocolConfigs(input.productLine.protocolConfigs);
  if (currentConfigs !== null && !input.repairExplicitDrift) {
    return { kind: "unchanged", productLine: input.productLine };
  }

  const plugin = findChannelPlugin(input.providerCode);
  if (!plugin) {
    return { kind: "unchanged", productLine: input.productLine };
  }
  const variant = resolveChannelVariant(plugin, input.productLine.protocolConfigs);
  const targetProtocols = input.requestedProtocols
    ?? input.fallbackProtocols
    ?? variantProtocols(variant);
  if (!targetProtocols.length) {
    return { kind: "unchanged", productLine: input.productLine };
  }
  const resolution = resolveVariantProtocolConfigs(variant, targetProtocols);
  if (!resolution.ok) {
    return {
      kind: "protocol_unsupported",
      unsupportedProtocols: resolution.unsupportedProtocols,
    };
  }

  const plan = planEmptyChannelProtocolConfigInitialization({
    credentialCount: input.credentialCount,
    currentProtocolConfigs: input.productLine.protocolConfigs,
    targetProtocolConfigs: resolution.configs,
    currentConfigVersion: input.productLine.configVersion,
    protocolsExplicitlyRequested: input.repairExplicitDrift,
  });
  if (!plan.shouldInitialize) {
    return { kind: "unchanged", productLine: input.productLine };
  }

  const [updated] = await tx
    .update(productLines)
    .set({
      protocolConfigs: resolution.configs,
      configVersion: plan.nextConfigVersion,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(productLines.id, input.productLine.id),
        eq(productLines.configVersion, input.productLine.configVersion),
      ),
    )
    .returning();
  return updated
    ? { kind: "initialized", productLine: updated }
    : { kind: "config_stale" };
}

async function testCredentialConnection(
  credentialId: number,
  preferredProtocol?: RelayProtocol,
): Promise<CredentialTestResult> {
  const [credential] = await db
    .select({
      id: upstreamCredentials.id,
      productLineId: upstreamCredentials.productLineId,
      secretEncrypted: upstreamCredentials.secretEncrypted,
      meta: upstreamCredentials.meta,
      fiveHourWindowAnchor: upstreamCredentials.fiveHourWindowAnchor,
      weeklyWindowResetAt: upstreamCredentials.weeklyWindowResetAt,
      lineWeeklyWindowResetAt: productLines.weeklyWindowResetAt,
      supportedProtocols: upstreamCredentials.supportedProtocols,
      providerCode: providers.code,
      authStyle: providers.authStyle,
      defaultBaseUrl: providers.defaultBaseUrl,
      baseUrlOverride: productLines.baseUrlOverride,
      protocolConfigs: productLines.protocolConfigs,
      configVersion: productLines.configVersion,
      testModel: productLines.testModel,
    })
    .from(upstreamCredentials)
    .innerJoin(productLines, eq(upstreamCredentials.productLineId, productLines.id))
    .innerJoin(providers, eq(productLines.providerId, providers.id))
    .where(eq(upstreamCredentials.id, credentialId))
    .limit(1);

  if (!credential) {
    throw new Error("凭证不存在");
  }

  const protocol = resolveUpstreamTestProtocol(credential.supportedProtocols, preferredProtocol);
  const upstreamConfig = resolveProtocolUpstreamConfig({
    protocol,
    protocolConfigs: credential.protocolConfigs,
    legacyBaseUrl: credential.baseUrlOverride || credential.defaultBaseUrl,
    legacyAuthStyle: credential.authStyle,
  });
  if (!upstreamConfig) {
    throw new Error("该渠道缺少所选协议的端点配置");
  }

  const previousMeta = credential.meta && typeof credential.meta === "object"
    ? credential.meta as Record<string, unknown>
    : {};
  const discoveredModels = Array.isArray(previousMeta.discoveredModels)
    ? previousMeta.discoveredModels.filter((name): name is string =>
      typeof name === "string" && name.trim().length > 0)
    : [];

  let result: CredentialTestResult;
  try {
    const secret = decryptSecret(credential.secretEncrypted);
    result = await probeUpstreamModels({
      providerCode: credential.providerCode,
      protocol,
      baseUrl: upstreamConfig.baseUrl,
      authStyle: upstreamConfig.authStyle,
      secret,
      // 渠道显式配置的测试模型优先于历史发现的模型。
      model: credential.testModel ?? undefined,
      discoveredModels,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message === "当前仅支持对已确认供应商的官方 HTTPS 地址进行连通性测试"
      || message === "自定义渠道缺少可测试的上游地址"
      || message === "无法确定测试模型"
    ) {
      throw error;
    }
    result = {
      ok: false,
      testedAt: new Date().toISOString(),
      latencyMs: 0,
      httpStatus: null,
      modelCount: 0,
      models: [],
      protocol,
      rawBody: null,
      message,
    };
  }

  const now = new Date();
  const cooldown = resolveRelayRateLimitCooldown(
    result.rawBody,
    env.RELAY_COOLDOWN_SECONDS,
    env.RELAY_QUOTA_COOLDOWN_SECONDS,
    now,
    credentialWindowAnchors(credential),
    credential.providerCode,
    result.httpStatus ?? undefined,
  );
  const shouldCool = !result.ok
    && (result.httpStatus === 429 || cooldown.quotaExhausted || cooldown.cap != null);
  // 对齐 relay 语义：成功仅在冷却已到期时解除（markCredentialSuccess 同款条件），
  // 失败只延长不缩短（coolCredential 的 greatest），避免管理员「测试」清掉/缩短 relay 写入的冷却。
  const failedCoolUntilIso = (
    cooldown.coolUntil ?? new Date(now.getTime() + cooldown.cooldownSeconds * 1_000)
  ).toISOString();
  // 报文带未来重置时刻时校准窗口状态列（1308 → 首用锚点，1310 → 周相位）。
  const calibrationReset = cooldown.cap?.resetAt
    && cooldown.cap.resetAt.getTime() > now.getTime()
    ? cooldown.cap.resetAt
    : null;
  const cooldownExpired = sql`(${upstreamCredentials.coolUntil} is null or ${upstreamCredentials.coolUntil} <= now())`;
  const coolUntilUpdate = result.ok
    ? sql`case
        when ${upstreamCredentials.status} = 'cooling' and ${cooldownExpired}
        then null
        else ${upstreamCredentials.coolUntil}
      end`
    : shouldCool
      ? sql`greatest(
          coalesce(${upstreamCredentials.coolUntil}, ${failedCoolUntilIso}::timestamptz),
          ${failedCoolUntilIso}::timestamptz
        )`
      : undefined;

  await db.transaction(async (tx) => {
    const [currentChannel] = await tx
      .select({
        configVersion: productLines.configVersion,
        protocolConfigs: productLines.protocolConfigs,
        baseUrlOverride: productLines.baseUrlOverride,
        defaultBaseUrl: providers.defaultBaseUrl,
        authStyle: providers.authStyle,
      })
      .from(productLines)
      .innerJoin(providers, eq(productLines.providerId, providers.id))
      .where(eq(productLines.id, credential.productLineId))
      .limit(1)
      .for("share");
    if (!currentChannel || currentChannel.configVersion !== credential.configVersion) return;
    const currentUpstreamConfig = resolveProtocolUpstreamConfig({
      protocol,
      protocolConfigs: currentChannel.protocolConfigs,
      legacyBaseUrl: currentChannel.baseUrlOverride || currentChannel.defaultBaseUrl,
      legacyAuthStyle: currentChannel.authStyle,
    });
    if (
      !currentUpstreamConfig ||
      currentUpstreamConfig.baseUrl !== upstreamConfig.baseUrl ||
      currentUpstreamConfig.authStyle !== upstreamConfig.authStyle
    ) {
      return;
    }

    await tx
      .update(upstreamCredentials)
      .set({
        meta: {
          ...previousMeta,
          lastTest: {
            ok: result.ok,
            testedAt: result.testedAt,
            latencyMs: result.latencyMs,
            httpStatus: result.httpStatus,
            modelCount: result.modelCount,
            models: result.models,
            message: result.message,
            protocol: result.protocol,
          },
          discoveredModels: result.models,
        },
        lastError: result.ok ? null : result.message,
        lastErrorAt: result.ok ? null : now,
        lastFailureKind: result.ok ? null : (shouldCool ? cooldown.failureKind : "other"),
        lastVendorCode: result.ok ? null : cooldown.vendorCode,
        ...(calibrationReset && cooldown.cap?.kind === "five_hour"
          ? {
              fiveHourWindowAnchor: new Date(calibrationReset.getTime() - FIVE_HOUR_MS),
              fiveHourWindowBaseCredits: fiveHourBaseCreditsBeforeSql(
                new Date(calibrationReset.getTime() - FIVE_HOUR_MS),
              ),
            }
          : {}),
        ...(calibrationReset && cooldown.cap?.kind === "weekly"
          ? { weeklyWindowResetAt: calibrationReset }
          : {}),
        ...(coolUntilUpdate !== undefined ? { coolUntil: coolUntilUpdate } : {}),
        status: result.ok
          ? sql`case
              when ${upstreamCredentials.status} = 'cooling' and ${cooldownExpired}
              then 'active'::credential_status
              else ${upstreamCredentials.status}
            end`
          : shouldCool
            ? sql`case
                when ${upstreamCredentials.status} in ('active', 'cooling')
                then 'cooling'::credential_status
                else ${upstreamCredentials.status}
              end`
            : sql`${upstreamCredentials.status}`,
        updatedAt: now,
      })
      .where(
        and(
          eq(upstreamCredentials.id, credential.id),
          eq(upstreamCredentials.secretEncrypted, credential.secretEncrypted),
        ),
      );
  });

  return result;
}


function beijingWallTime(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

/** 官方说这个窗口已用满：冷却到官方的重置时刻，并校准窗口相位（与收到 1308 / 1310 时一致）。 */
async function applyOfficialCooling(
  credentialId: number,
  kind: QuotaCapKind,
  until: Date,
  currentKind: string | null,
  now: Date,
): Promise<void> {
  const untilIso = until.toISOString();
  // 原来就是额度冷却：以官方时刻为准（可能缩短）；其他原因的冷却取较晚的。
  const replaceCooling = currentKind == null || QUOTA_CAP_KINDS.includes(currentKind as QuotaCapKind);
  const label = kind === "weekly_cap" ? "本周" : "5 小时";
  await db
    .update(upstreamCredentials)
    .set({
      status: sql`'cooling'::credential_status`,
      coolUntil: replaceCooling
        ? until
        : sql`greatest(coalesce(${upstreamCredentials.coolUntil}, ${untilIso}::timestamptz), ${untilIso}::timestamptz)`,
      lastFailureKind: kind,
      lastVendorCode: null,
      lastError: `官方额度：${label}已用 100%，${beijingWallTime(until)} 后恢复`,
      lastErrorAt: now,
      updatedAt: now,
      ...(kind === "weekly_cap"
        ? { weeklyWindowResetAt: until }
        : {
            fiveHourWindowAnchor: new Date(until.getTime() - FIVE_HOUR_MS),
            fiveHourWindowBaseCredits: fiveHourBaseCreditsBeforeSql(new Date(until.getTime() - FIVE_HOUR_MS)),
          }),
    })
    .where(and(
      eq(upstreamCredentials.id, credentialId),
      inArray(upstreamCredentials.status, ["active", "cooling"]),
    ));
}

/** 额度冷却已过时（官方两个窗口都没满）：解除冷却，周相位改用官方的重置时刻。 */
async function releaseOfficialCooling(
  credentialId: number,
  weeklyResetAt: string | null,
  now: Date,
): Promise<void> {
  const weeklyReset = weeklyResetAt ? new Date(weeklyResetAt) : null;
  await db
    .update(upstreamCredentials)
    .set({
      status: sql`case when ${upstreamCredentials.status} = 'cooling' then 'active'::credential_status else ${upstreamCredentials.status} end`,
      coolUntil: null,
      lastFailureKind: null,
      lastVendorCode: null,
      updatedAt: now,
      ...(weeklyReset && weeklyReset.getTime() > now.getTime() ? { weeklyWindowResetAt: weeklyReset } : {}),
    })
    .where(and(
      eq(upstreamCredentials.id, credentialId),
      inArray(upstreamCredentials.status, ["active", "cooling"]),
      inArray(upstreamCredentials.lastFailureKind, [...QUOTA_CAP_KINDS]),
    ));
}

export async function adminCredentialRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requireRoles("admin"));

  app.get("/api/admin/credential-submissions", async (req, reply) => {
    const query = z
      .object({
        productLineId: z.coerce.number().int().positive().optional(),
      })
      .safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const people = await db
      .select({
        id: employees.id,
        name: employees.name,
        phone: employees.phone,
        role: employees.role,
        status: employees.status,
        enterpriseName: enterprises.name,
      })
      .from(employees)
      .leftJoin(enterprises, eq(employees.enterpriseId, enterprises.id))
      .where(ne(employees.role, "admin"))
      .orderBy(asc(employees.id));

    const credentialRows = await db
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
        meta: upstreamCredentials.meta,
      })
      .from(upstreamCredentials)
      .innerJoin(productLines, eq(upstreamCredentials.productLineId, productLines.id))
      .innerJoin(providers, eq(productLines.providerId, providers.id))
      .where(
        query.data.productLineId
          ? and(
            sql`${upstreamCredentials.meta}->>'createdBy' = 'employee_submit'`,
            eq(upstreamCredentials.productLineId, query.data.productLineId),
          )
          : sql`${upstreamCredentials.meta}->>'createdBy' = 'employee_submit'`,
      )
      .orderBy(desc(upstreamCredentials.id));

    const views = presentEmployeeSubmittedCredentials(
      credentialRows.map((row) => ({
        id: row.id,
        productLineId: row.productLineId,
        productLineName: row.productLineName,
        providerName: row.providerName,
        providerCode: row.providerCode,
        label: row.label,
        secretSuffix: row.secretSuffix,
        status: row.status as CredentialStatus,
        coolUntil: row.coolUntil,
        createdAt: row.createdAt,
      })),
    );
    const submissions = views.flatMap((view, index) => {
      const employeeId = submittedByEmployeeIdFromMeta(credentialRows[index]?.meta);
      if (employeeId == null) return [];
      return [{
        credentialId: view.id,
        employeeId,
        productLineId: view.productLineId,
        productLineName: view.productLineName,
        providerName: view.providerName,
        secretSuffix: view.secretSuffix,
        status: view.status,
        createdAt: view.createdAt,
      }];
    });

    const roster = partitionCredentialSubmitRoster(people, submissions);
    return {
      success: true,
      data: {
        submittedCount: roster.submitted.length,
        unsubmittedCount: roster.unsubmitted.length,
        submitted: roster.submitted,
        unsubmitted: roster.unsubmitted,
      },
    };
  });

  app.get("/api/admin/product-lines/:id/summary", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ success: false, message: "渠道 ID 无效" });
    }

    const [located] = await db
      .select({ productLine: productLines, provider: providers })
      .from(productLines)
      .innerJoin(providers, eq(productLines.providerId, providers.id))
      .where(eq(productLines.id, params.data.id))
      .limit(1);
    if (!located) {
      return reply.code(404).send({ success: false, message: "渠道不存在" });
    }

    const credentialRows = await db
      .select({
        id: upstreamCredentials.id,
        label: upstreamCredentials.label,
        tag: upstreamCredentials.tag,
        secretSuffix: upstreamCredentials.secretSuffix,
        status: upstreamCredentials.status,
        coolUntil: upstreamCredentials.coolUntil,
        weight: upstreamCredentials.weight,
        supportedProtocols: upstreamCredentials.supportedProtocols,
        fiveHourWindowAnchor: upstreamCredentials.fiveHourWindowAnchor,
        fiveHourWindowBaseCredits: upstreamCredentials.fiveHourWindowBaseCredits,
        weeklyWindowResetAt: upstreamCredentials.weeklyWindowResetAt,
        lastFailureKind: upstreamCredentials.lastFailureKind,
      })
      .from(upstreamCredentials)
      .where(eq(upstreamCredentials.productLineId, located.productLine.id));
    const credentialIds = credentialRows.map((row) => row.id);
    const recentSince = new Date(Date.now() - RECENT_WINDOW_MS);
    const [recent] = credentialIds.length
      ? await db
        .select({
          recentSuccessCount: sql<number>`coalesce(sum(case when ${requestAudits.status} = 'success' then 1 else 0 end), 0)::int`,
          recentErrorCount: sql<number>`coalesce(sum(case when ${requestAudits.status} <> 'success' then 1 else 0 end), 0)::int`,
        })
        .from(requestAudits)
        .where(and(
          inArray(requestAudits.credentialId, credentialIds),
          gte(requestAudits.createdAt, recentSince),
        ))
      : [{ recentSuccessCount: 0, recentErrorCount: 0 }];

    const now = new Date();
    const lineWeeklyWindowResetAt = located.productLine.weeklyWindowResetAt;
    const lineMonthlyWindowResetAt = located.productLine.monthlyWindowResetAt;
    const monthlyCreditLimit = located.productLine.monthlyCreditLimit;
    const summaryAnchorsById = new Map<number, CredentialWindowAnchors>(
      credentialRows.map((row) => [
        row.id,
        credentialWindowAnchors({
          ...row,
          lineWeeklyWindowResetAt,
          monthlyCreditLimit,
          lineMonthlyWindowResetAt,
        }),
      ]),
    );
    const [usageById, membershipById] = await Promise.all([
      getCredentialQuotaUsage(credentialIds, now, summaryAnchorsById),
      loadCredentialMembers(credentialIds),
    ]);
    const effectiveStatuses = credentialRows.map((row) => ({
      ...row,
      effectiveStatus: effectiveCredentialStatus(row.status, row.coolUntil, now),
    }));
    const channelEnabled = located.provider.status === "active"
      && located.productLine.status === "active";
    const schedulableCount = channelEnabled
      ? effectiveStatuses.filter((row) => row.effectiveStatus === "active" && row.weight > 0).length
      : 0;
    const coolingCount = effectiveStatuses.filter(
      (row) => row.effectiveStatus === "cooling",
    ).length;
    const configured = configuredProtocols(
      parseProductLineProtocolConfigs(located.productLine.protocolConfigs),
    );
    const supported = new Set(credentialRows.flatMap((row) => row.supportedProtocols));
    const protocols = configured.length
      ? configured
      : RELAY_PROTOCOLS.filter((protocol) => supported.has(protocol));

    return {
      success: true,
      data: {
        id: located.productLine.id,
        code: located.productLine.code,
        name: located.productLine.name,
        productType: located.productLine.productType,
        allowAutoRoute: located.productLine.allowAutoRoute,
        status: located.productLine.status,
        provider: {
          id: located.provider.id,
          code: located.provider.code,
          name: located.provider.name,
          status: located.provider.status,
        },
        baseUrl: located.productLine.baseUrlOverride || located.provider.defaultBaseUrl,
        protocolConfigs: located.productLine.protocolConfigs,
        configVersion: located.productLine.configVersion,
        protocols,
        stats: {
          totalCount: credentialRows.length,
          schedulableCount,
          coolingCount,
          unschedulableCount: Math.max(
            0,
            credentialRows.length - schedulableCount - coolingCount,
          ),
          recentWindowHours: 24,
          recentSuccessCount: Number(recent?.recentSuccessCount) || 0,
          recentErrorCount: Number(recent?.recentErrorCount) || 0,
        },
        credentials: effectiveStatuses.map((row) => {
          const usage = usageById.get(row.id) ?? { fiveHourCredits: 0, weeklyCredits: 0 };
          // 积分上限只在套餐上设置，套餐下每把 Key 都按它算。
          const limits = packageCreditLimits(located.productLine);
          return {
            id: row.id,
            label: row.label,
            tag: row.tag,
            secretSuffix: row.secretSuffix,
            status: row.status,
            effectiveStatus: row.effectiveStatus,
            weight: row.weight,
            supportedProtocols: row.supportedProtocols,
            fiveHourCreditLimit: limits.fiveHourLimit,
            weeklyCreditLimit: limits.weeklyLimit,
            monthlyCreditLimit: limits.monthlyLimit ?? null,
            fiveHourCredits: usage.fiveHourCredits,
            weeklyCredits: usage.weeklyCredits,
            monthlyCredits: usage.monthlyCredits ?? 0,
            nextFiveHourResetAt: nextFiveHourResetAt(row.fiveHourWindowAnchor, now),
            nextWeeklyResetAt: nextWeeklyResetAt(
              effectiveWeeklyResetAt({ ...row, lineWeeklyWindowResetAt }),
              now,
            ),
            lastFailureKind: row.lastFailureKind,
            ...membershipView(
              membershipById.get(row.id),
              effectiveKeyMaxMembers(located.productLine.keyMaxMembers),
            ),
          };
        }),
      },
    };
  });

  app.get("/api/admin/credentials", async (req, reply) => {
    const parsed = z
      .object({
        productLineId: z.coerce.number().optional(),
        status: z.string().optional(),
      })
      .safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const query = parsed.data;

    const rows = await db
      .select({
        id: upstreamCredentials.id,
        productLineId: upstreamCredentials.productLineId,
        label: upstreamCredentials.label,
        tag: upstreamCredentials.tag,
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
        fiveHourCreditLimit: productLines.fiveHourCreditLimit,
        weeklyCreditLimit: productLines.weeklyCreditLimit,
        monthlyCreditLimit: productLines.monthlyCreditLimit,
        fiveHourWindowAnchor: upstreamCredentials.fiveHourWindowAnchor,
        fiveHourWindowBaseCredits: upstreamCredentials.fiveHourWindowBaseCredits,
        weeklyWindowResetAt: upstreamCredentials.weeklyWindowResetAt,
        lineWeeklyWindowResetAt: productLines.weeklyWindowResetAt,
        lineMonthlyWindowResetAt: productLines.monthlyWindowResetAt,
        lastFailureKind: upstreamCredentials.lastFailureKind,
        lastVendorCode: upstreamCredentials.lastVendorCode,
        // KEYS 表格「刷新」写入的官方额度快照，看板优先按它画圈。
        officialQuota: upstreamCredentials.officialQuota,
        officialQuotaAt: upstreamCredentials.officialQuotaAt,
        createdAt: upstreamCredentials.createdAt,
        updatedAt: upstreamCredentials.updatedAt,
        productLineCode: productLines.code,
        productLineName: productLines.name,
        productLineStatus: productLines.status,
        productType: productLines.productType,
        allowAutoRoute: productLines.allowAutoRoute,
        providerCode: providers.code,
        providerName: providers.name,
        providerStatus: providers.status,
        defaultBaseUrl: providers.defaultBaseUrl,
        baseUrlOverride: productLines.baseUrlOverride,
        protocolConfigs: productLines.protocolConfigs,
        configVersion: productLines.configVersion,
        seatCount: productLines.seatCount,
        productLineTag: productLines.tag,
        testModel: productLines.testModel,
        keyMaxMembers: productLines.keyMaxMembers,
        keyMaxConcurrency: productLines.keyMaxConcurrency,
        holderEmployeeId: channelSeats.employeeId,
        holderName: employees.name,
      })
      .from(upstreamCredentials)
      .innerJoin(productLines, eq(upstreamCredentials.productLineId, productLines.id))
      .innerJoin(providers, eq(productLines.providerId, providers.id))
      .leftJoin(channelSeats, eq(channelSeats.credentialId, upstreamCredentials.id))
      .leftJoin(employees, eq(employees.id, channelSeats.employeeId))
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
    const now = new Date();
    const anchorsById = new Map<number, CredentialWindowAnchors>(
      rows.map((row) => [row.id, credentialWindowAnchors(row)]),
    );
    const [recentRows, usageById, membershipById, connectedNamesById] = await Promise.all([
      credentialIds.length
        ? db
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
        : Promise.resolve([]),
      getCredentialQuotaUsage(credentialIds, now, anchorsById),
      loadCredentialMembers(credentialIds),
      loadConnectedNamesByCredential(rows),
    ]);

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

    const productLineRows = await db
      .select({
        id: productLines.id,
        code: productLines.code,
        name: productLines.name,
        status: productLines.status,
        productType: productLines.productType,
        protocolConfigs: productLines.protocolConfigs,
        configVersion: productLines.configVersion,
        baseUrlOverride: productLines.baseUrlOverride,
        providerCode: providers.code,
        providerName: providers.name,
        providerStatus: providers.status,
        defaultBaseUrl: providers.defaultBaseUrl,
        seatCount: productLines.seatCount,
        tag: productLines.tag,
      })
      .from(productLines)
      .innerJoin(providers, eq(productLines.providerId, providers.id))
      .orderBy(asc(productLines.id));

    return {
      success: true,
      data: rows.map((row) => {
        const usage = usageById.get(row.id) ?? { fiveHourCredits: 0, weeklyCredits: 0 };
        const connectedNames: string[] = [];
        for (const name of connectedNamesById.get(row.id) ?? []) pushUniqueName(connectedNames, name);
        // 积分上限来自套餐，套餐下每把 Key 相同。
        const limits = packageCreditLimits(row);
        return {
          ...row,
          recentWindowHours: 24,
          recentSuccessCount: recentById.get(row.id)?.recentSuccessCount ?? 0,
          recentErrorCount: recentById.get(row.id)?.recentErrorCount ?? 0,
          fiveHourCreditLimit: limits.fiveHourLimit,
          weeklyCreditLimit: limits.weeklyLimit,
          monthlyCreditLimit: limits.monthlyLimit ?? null,
          fiveHourCredits: usage.fiveHourCredits,
          weeklyCredits: usage.weeklyCredits,
          monthlyCredits: usage.monthlyCredits ?? 0,
          // 5h：窗口进行中 → 锚点+5h；已过期/未锚定 → null（满血，下次调用起算）。
          nextFiveHourResetAt: nextFiveHourResetAt(row.fiveHourWindowAnchor, now),
          // 周窗口：Key 自己学到的时刻优先，其次是套餐上录入的时间，滚到下一期；
          // 两者都没有时只能按固定 epoch 估算并标记。
          nextWeeklyResetAt: nextWeeklyResetAt(effectiveWeeklyResetAt(row), now),
          weeklyResetEstimated: effectiveWeeklyResetAt(row) == null,
          // 月额度（火山方舟）：套餐录入的订阅日起按自然月滚动，没录入按北京时间每月 1 日。
          nextMonthlyResetAt: limits.monthlyLimit != null
            ? monthlyWindowBounds(row.lineMonthlyWindowResetAt ?? null, now).end.toISOString()
            : null,
          lastFailureKind: row.lastFailureKind,
          lastVendorCode: row.lastVendorCode,
          ...membershipView(
            membershipById.get(row.id),
            effectiveKeyMaxMembers(row.keyMaxMembers),
          ),
          connectedNames,
        };
      }),
      productLines: productLineRows.map((line) => ({
        ...line,
        baseUrl: line.baseUrlOverride || line.defaultBaseUrl,
      })),
    };
  });

  type OfficialQuotaRow = {
    credentialId: number;
    state: "ok" | "error" | "unconfigured" | "unsupported";
    message?: string;
    level?: string;
    fiveHour?: QuotaWindow | null;
    weekly?: QuotaWindow | null;
  };

  app.get("/api/admin/credentials/official-quota", async () => {
    const rows = await db
      .select({
        id: upstreamCredentials.id,
        officialQuota: upstreamCredentials.officialQuota,
        officialQuotaAt: upstreamCredentials.officialQuotaAt,
      })
      .from(upstreamCredentials);

    let queriedAt: Date | null = null;
    const data: OfficialQuotaRow[] = [];
    for (const row of rows) {
      if (!row.officialQuota || !row.officialQuotaAt) continue;
      data.push({ ...(row.officialQuota as Omit<OfficialQuotaRow, "credentialId">), credentialId: row.id });
      if (!queriedAt || row.officialQuotaAt > queriedAt) queriedAt = row.officialQuotaAt;
    }
    return { data, queriedAt: queriedAt?.toISOString() ?? null };
  });

  app.post("/api/admin/credentials/official-quota/refresh", async () => {
    const rows = await db
      .select({
        id: upstreamCredentials.id,
        secretEncrypted: upstreamCredentials.secretEncrypted,
        status: upstreamCredentials.status,
        coolUntil: upstreamCredentials.coolUntil,
        lastFailureKind: upstreamCredentials.lastFailureKind,
        productType: productLines.productType,
        providerCode: providers.code,
        zhipuOrganizationId: productLines.zhipuOrganizationId,
        zhipuProjectId: productLines.zhipuProjectId,
        officialQuotaQueryEnabled: productLines.officialQuotaQueryEnabled,
      })
      .from(upstreamCredentials)
      .innerJoin(productLines, eq(upstreamCredentials.productLineId, productLines.id))
      .innerJoin(providers, eq(productLines.providerId, providers.id));

    const data: OfficialQuotaRow[] = rows.map((row) => ({
      credentialId: row.id,
      state: "unsupported",
    }));
    const pending: Array<{ index: number; organizationId: string; projectId: string; secretEncrypted: string }> = [];

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (!row?.officialQuotaQueryEnabled) continue;
      if (row.providerCode !== "glm" || row.productType !== "coding_plan") continue;
      const organizationId = row.zhipuOrganizationId?.trim() ?? "";
      const projectId = row.zhipuProjectId?.trim() ?? "";
      if (!organizationId || !projectId) {
        data[index] = { credentialId: row.id, state: "unconfigured" };
        continue;
      }
      pending.push({
        index,
        organizationId,
        projectId,
        secretEncrypted: row.secretEncrypted,
      });
    }

    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(8, pending.length) },
      async () => {
        while (cursor < pending.length) {
          const current = cursor;
          cursor += 1;
          const item = pending[current];
          if (!item) continue;
          const credentialId = rows[item.index]?.id;
          if (credentialId == null) continue;
          let apiKey: string;
          try {
            apiKey = decryptSecret(item.secretEncrypted);
          } catch {
            data[item.index] = { credentialId, state: "error", message: "无法解密凭据" };
            continue;
          }
          const result = await fetchZhipuTeamQuota({
            apiKey,
            organizationId: item.organizationId,
            projectId: item.projectId,
          });
          data[item.index] = result.ok
            ? {
                credentialId,
                state: "ok",
                level: result.level,
                fiveHour: result.fiveHour,
                weekly: result.weekly,
              }
            : { credentialId, state: "error", message: result.message };
        }
      },
    );
    await Promise.all(workers);

    const queriedAt = new Date();
    await Promise.all(
      data.map(({ credentialId, ...snapshot }) =>
        db
          .update(upstreamCredentials)
          .set({ officialQuota: snapshot, officialQuotaAt: queriedAt })
          .where(eq(upstreamCredentials.id, credentialId)),
      ),
    );

    // 官方快照比 relay 记下的冷却新：按它校正 Key 的冷却状态，调度和看板随之准确。
    const reconciled = { cooled: 0, released: 0 };
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const quota = data[index];
      if (!row || !quota || quota.state !== "ok") continue;
      const target = officialCoolingTarget({
        status: row.status,
        coolUntil: row.coolUntil,
        lastFailureKind: row.lastFailureKind,
        fiveHour: quota.fiveHour,
        weekly: quota.weekly,
        now: queriedAt,
      });
      if (target.action === "cool") {
        await applyOfficialCooling(row.id, target.kind, target.until, row.lastFailureKind, queriedAt);
        reconciled.cooled += 1;
      } else if (target.action === "release") {
        await releaseOfficialCooling(row.id, quota.weekly?.resetAt ?? null, queriedAt);
        reconciled.released += 1;
      }
    }

    return {
      data,
      queriedAt: queriedAt.toISOString(),
      reconciled,
    };
  });

  app.post(
    "/api/admin/credentials",
    { preHandler: [requireRoles("admin")] },
    async (req, reply) => {
      const body = z
        .object({
          productLineId: z.number().int().positive(),
          label: z.string().min(1).max(200),
          secret: upstreamSecretSchema,
          supportedProtocols: supportedProtocolsSchema.optional(),
          weight: z.number().int().min(0).max(10000).default(100),
          priority: z.number().int().default(0),
          meta: z.record(z.unknown()).optional(),
        })
        .safeParse(req.body);

      if (!body.success) {
        return reply.code(400).send({ success: false, message: "参数无效" });
      }

      const result = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${body.data.productLineId})`,
        );
        const [located] = await tx
          .select({
            productLine: productLines,
            providerCode: providers.code,
          })
          .from(productLines)
          .innerJoin(providers, eq(productLines.providerId, providers.id))
          .where(eq(productLines.id, body.data.productLineId))
          .limit(1)
          .for("share");
        if (!located) return { kind: "product_line_not_found" } as const;
        let productLine = located.productLine;
        const existingRows = await tx
          .select({
            id: upstreamCredentials.id,
            secretEncrypted: upstreamCredentials.secretEncrypted,
            supportedProtocols: upstreamCredentials.supportedProtocols,
          })
          .from(upstreamCredentials)
          .where(eq(upstreamCredentials.productLineId, productLine.id));
        const initialization = await initializeEmptyTemplateChannelProtocolConfigs(tx, {
          productLine,
          providerCode: located.providerCode,
          credentialCount: existingRows.length,
          requestedProtocols: body.data.supportedProtocols,
          repairExplicitDrift: body.data.supportedProtocols !== undefined,
        });
        if (initialization.kind === "protocol_unsupported") return initialization;
        if (initialization.kind === "config_stale") return initialization;
        productLine = initialization.productLine;
        const protocolResolution = resolveChannelCredentialInsertProtocols(
          existingRows,
          body.data.supportedProtocols,
          configuredProtocols(parseProductLineProtocolConfigs(productLine.protocolConfigs)),
        );
        if (protocolResolution.kind === "mismatch") {
          return {
            kind: "channel_protocol_mismatch",
            channelProtocols: protocolResolution.channelProtocols,
          } as const;
        }
        if (protocolResolution.kind === "unset") {
          return { kind: "channel_protocol_unset" } as const;
        }
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
            supportedProtocols: protocolResolution.protocols,
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
      if (result.kind === "config_stale") {
        return reply.code(409).send({
          success: false,
          code: "CHANNEL_CONFIG_STALE",
          message: "渠道配置已被其他操作更新，请刷新后重试",
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
      if (result.kind === "existing_secret_unreadable") {
        return reply.code(409).send({
          success: false,
          message: "渠道中存在无法解密的旧 Key，无法安全完成重复检查",
          credentialIds: result.credentialIds,
        });
      }
      if (result.kind === "channel_protocol_mismatch") {
        return reply.code(409).send({
          success: false,
          code: "CHANNEL_PROTOCOL_MISMATCH",
          message: "渠道协议已发生变化，请刷新后重试",
          supportedProtocols: result.channelProtocols,
        });
      }
      if (result.kind === "channel_protocol_unset") {
        return reply.code(400).send({
          success: false,
          code: "CHANNEL_PROTOCOLS_UNSET",
          message: "渠道尚未配置支持协议，请显式选择协议",
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
      const params = z
        .object({ id: z.coerce.number().int().positive() })
        .safeParse(req.params);
      const rawBody = req.body && typeof req.body === "object"
        ? req.body as Record<string, unknown>
        : {};
      if (
        Object.prototype.hasOwnProperty.call(rawBody, "baseUrl") ||
        Object.prototype.hasOwnProperty.call(rawBody, "supportedProtocols")
      ) {
        return reply.code(400).send({
          success: false,
          code: "CHANNEL_LEVEL_FIELD",
          message: "Base URL 和支持协议属于渠道配置，请通过渠道编辑功能修改",
        });
      }
      const body = z
        .object({
          label: z.string().min(1).max(200).optional(),
          secret: upstreamSecretSchema.optional(),
          weight: z.number().int().min(0).max(10000).optional(),
          priority: z.number().int().optional(),
          status: z
            .enum(["active", "disabled", "auto_disabled", "cooling"])
            .optional(),
          coolUntil: z.string().datetime().nullable().optional(),
          meta: z.record(z.unknown()).nullable().optional(),
        })
        .strict()
        .refine((value) => Object.keys(value).length > 0, {
          message: "至少提供一个要修改的字段",
        })
        .safeParse(req.body);

      if (!params.success || !body.success) {
        return reply.code(400).send({ success: false, message: "参数无效" });
      }

      const result = await db.transaction(async (tx) => {
        const [location] = await tx
          .select({ productLineId: upstreamCredentials.productLineId })
          .from(upstreamCredentials)
          .where(eq(upstreamCredentials.id, params.data.id))
          .limit(1);
        if (!location) return { kind: "not_found" } as const;

        // Channel-wide writes and credential create/import take this lock
        // before locking credential rows. Keeping that order prevents the
        // credential -> advisory / advisory -> credential deadlock.
        await tx.execute(
          sql`select pg_advisory_xact_lock(${location.productLineId})`,
        );
        const [existing] = await tx
          .select({
            id: upstreamCredentials.id,
            productLineId: upstreamCredentials.productLineId,
            meta: upstreamCredentials.meta,
          })
          .from(upstreamCredentials)
          .where(
            and(
              eq(upstreamCredentials.id, params.data.id),
              eq(upstreamCredentials.productLineId, location.productLineId),
            ),
          )
          .limit(1)
          .for("update");

        if (!existing) return { kind: "not_found" } as const;

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
        if (body.data.meta !== undefined) {
          patch.meta = body.data.secret === undefined
            ? body.data.meta
            : metaWithoutStaleTest(body.data.meta);
        }
        if (body.data.secret !== undefined) {
          patch.secretEncrypted = encryptSecret(body.data.secret);
          patch.secretSuffix = secretSuffix(body.data.secret);
          patch.meta ??= metaWithoutStaleTest(existing.meta);
          patch.lastError = null;
          patch.lastErrorAt = null;
        }

        if (body.data.secret !== undefined) {
          const targetCredentials = await tx
            .select({
              id: upstreamCredentials.id,
              secretEncrypted: upstreamCredentials.secretEncrypted,
            })
            .from(upstreamCredentials)
            .where(
              and(
                eq(upstreamCredentials.productLineId, existing.productLineId),
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
            inspectCredentialSecretDuplicates([body.data.secret], targetSecrets)
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
            productLineId: row.productLineId,
          },
          ip: req.ip,
        });

        return { kind: "updated", row } as const;
      });

      if (result.kind === "not_found") {
        return reply.code(404).send({ success: false, message: "凭证不存在" });
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

}
