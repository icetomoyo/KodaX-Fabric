import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, desc, eq, gt, inArray, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { env } from "../config.js";
import { db } from "../db/client.js";
import {
  employeeApiKeys,
  employees,
  enterprises,
  modelPrices,
  opsAuditLogs,
  productLines,
  providers,
  teamMembers,
  teams,
  requestAudits,
  upstreamCredentials,
  usageCountersDaily,
} from "../db/schema/index.js";
import { insertEnterprise } from "../lib/enterprise.js";
import { quotaDayAt, zonedMonthRange } from "../lib/quota-time.js";
import { listEmployeeTeamQuotaViews } from "../lib/team-quota.js";
import { encryptEmployeeApiKey, generateApiKey } from "../lib/api-key.js";
import {
  RELAY_BASE_PATH,
  RELAY_PROTOCOLS,
} from "../lib/relay/protocol.js";
import {
  attachPricesToChannelModels,
  groupDiscoveredModelsByChannel,
} from "../lib/discovered-models.js";
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
  teamId: z.number().int().positive(),
  productLineId: z.number().int().positive(),
  protocol: z.enum(RELAY_PROTOCOLS),
});

/**
 * `host` retains the client-facing port and, with Fastify's `trustProxy`, the
 * proxy-provided public host. Never derive this URL from the API listener port.
 */
export function buildRelayBaseUrl(
  request: Pick<FastifyRequest, "protocol" | "host">,
): string {
  return `${request.protocol}://${request.host}${RELAY_BASE_PATH}`;
}

export async function meRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("employee", "team_admin"));

  app.post("/api/me/enterprise-applications", async (req, reply) => {
    const body = z
      .object({ name: z.string().trim().min(1).max(100) })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ success: false, message: "请填写企业名称" });
    }

    const [current] = await db
      .select({
        id: employees.id,
        role: employees.role,
        enterpriseId: employees.enterpriseId,
      })
      .from(employees)
      .where(eq(employees.id, req.employeeId!))
      .limit(1);
    if (!current || current.role !== "employee") {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }
    if (current.enterpriseId != null) {
      return reply.code(409).send({ success: false, message: "已提交合作申请或已加入企业" });
    }

    try {
      const enterprise = await insertEnterprise({
        name: body.data.name,
        status: "pending",
      });
      await db
        .update(employees)
        .set({ enterpriseId: enterprise.id, updatedAt: new Date() })
        .where(eq(employees.id, current.id));

      await db.insert(opsAuditLogs).values({
        actorEmployeeId: req.employeeId,
        action: "enterprise.apply",
        targetType: "enterprise",
        targetId: String(enterprise.id),
        detail: { name: enterprise.name, code: enterprise.code },
        ip: req.ip,
      });

      req.session = {
        ...req.session!,
        enterpriseId: enterprise.id,
      };

      return {
        success: true,
        data: {
          enterprise: {
            id: enterprise.id,
            name: enterprise.name,
            code: enterprise.code,
            status: enterprise.status,
          },
        },
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("enterprises_name_uidx") || message.includes("unique")) {
        return reply.code(409).send({ success: false, message: "企业名称已存在" });
      }
      throw e;
    }
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
      .where(eq(employees.id, req.employeeId!))
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

    const teamRows = await db
      .select({
        id: teams.id,
        name: teams.name,
        status: teams.status,
        role: teamMembers.role,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(eq(teamMembers.employeeId, req.employeeId!))
      .orderBy(desc(teams.id));

    return { success: true, data: { enterprise, teams: teamRows } };
  });

  app.get("/api/me/upstream-channels", async (req) => {
    const channels = await getEmployeeUpstreamChannels(req.employeeId!);
    return { success: true, data: channels };
  });

  app.get("/api/me/models", async (req) => {
    const accessible = await getEmployeeUpstreamChannels(req.employeeId!);
    if (accessible.length === 0) {
      return { success: true, data: { channels: [] } };
    }

    const productLineIds = accessible.map((channel) => channel.productLineId);
    const [channelRows, prices] = await Promise.all([
      db
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
        .where(inArray(productLines.id, productLineIds)),
      db
        .select({
          model: modelPrices.model,
          promptPricePerMillion: modelPrices.promptPricePerMillion,
          completionPricePerMillion: modelPrices.completionPricePerMillion,
          cacheHitPricePerMillion: modelPrices.cacheHitPricePerMillion,
        })
        .from(modelPrices),
    ]);

    const groupedById = new Map(
      groupDiscoveredModelsByChannel(channelRows).map((channel) => [channel.id, channel]),
    );
    const channels = attachPricesToChannelModels(
      accessible.map((channel) => groupedById.get(channel.productLineId) ?? {
        id: channel.productLineId,
        name: channel.productLineName,
        code: channel.productLineCode,
        providerName: channel.providerName,
        providerCode: channel.providerCode,
        models: [],
      }),
      prices,
    );

    return { success: true, data: { channels } };
  });

  app.get("/api/me/api-keys", async (req) => {
    const rows = await db
      .select({
        id: employeeApiKeys.id,
        name: employeeApiKeys.name,
        keyPrefix: employeeApiKeys.keyPrefix,
        protocol: employeeApiKeys.protocol,
        productLineId: employeeApiKeys.productLineId,
        teamId: employeeApiKeys.teamId,
        teamName: teams.name,
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
      .leftJoin(teams, eq(employeeApiKeys.teamId, teams.id))
      .where(eq(employeeApiKeys.employeeId, req.employeeId!))
      .orderBy(desc(employeeApiKeys.id));

    if (rows.length === 0) {
      return { success: true, data: [] };
    }

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
      // employee -> admin transition could insert a new active Key
      // after the transition transaction had already revoked the old ones.
      const [owner] = await tx
        .select({
          role: employees.role,
          status: employees.status,
          mustChangePassword: employees.mustChangePassword,
          enterpriseId: employees.enterpriseId,
        })
        .from(employees)
        .where(eq(employees.id, req.employeeId!))
        .limit(1)
        .for("update");

      if (
        !owner ||
        (owner.role !== "employee" && owner.role !== "team_admin") ||
        owner.status !== "active" ||
        owner.mustChangePassword
      ) {
        return { outcome: "forbidden" } as const;
      }
      if (owner.enterpriseId == null) {
        return { outcome: "no_enterprise" } as const;
      }

      const [membership] = await tx
        .select({
          teamId: teams.id,
          teamName: teams.name,
          teamStatus: teams.status,
        })
        .from(teamMembers)
        .innerJoin(teams, eq(teamMembers.teamId, teams.id))
        .where(
          and(
            eq(teamMembers.employeeId, req.employeeId!),
            eq(teamMembers.teamId, body.data.teamId),
          ),
        )
        .limit(1);
      if (!membership || membership.teamStatus !== "active") {
        return { outcome: "no_team" } as const;
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
          teamName: membership.teamName,
        },
        ip: req.ip,
      });

      return { outcome: "created", row: created, channel, teamName: membership.teamName } as const;
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
        message: "请先加入团队后再创建 API Key",
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
        teamName: result.teamName,
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
    const today = quotaDayAt(new Date(), env.QUOTA_TIMEZONE);
    const monthStart = `${today.slice(0, 8)}01`;
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
      .where(eq(employees.id, req.employeeId!))
      .limit(1);
    const teamQuotas = await listEmployeeTeamQuotaViews(
      req.employeeId!,
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
          hasQuota: employee?.enterpriseStatus === "active" && teamQuotas.some((row) => row.teamQuota > 0),
        },
        teams: teamQuotas,
        relay: {
          baseUrl: buildRelayBaseUrl(req),
          note: "Authorization: Bearer <your employee API key>",
        },
      },
    };
  });

  app.get("/api/me/logs", async (req) => {
    const compareOp = z.enum(["gt", "lt"]);
    const optionalNonNegInt = z.coerce.number().int().min(0).optional();
    const query = z
      .object({
        limit: z.coerce.number().min(1).max(100).default(20),
        offset: z.coerce.number().min(0).default(0),
        tokensOp: compareOp.optional(),
        tokens: optionalNonNegInt,
      })
      .parse(req.query);

    const conditions: SQL[] = [eq(requestAudits.employeeId, req.employeeId!)];
    if (query.tokensOp && query.tokens != null) {
      conditions.push(
        query.tokensOp === "gt"
          ? gt(requestAudits.totalTokens, query.tokens)
          : lt(requestAudits.totalTokens, query.tokens),
      );
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
        .limit(query.limit)
        .offset(query.offset),
    ]);

    return {
      success: true,
      data: { total: countRow?.total ?? 0, items },
    };
  });
}
