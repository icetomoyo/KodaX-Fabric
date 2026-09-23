import type { FastifyInstance } from "fastify";
import { and, desc, eq, gt, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import {
  departments,
  employees,
  enterprises,
  productLines,
  providers,
  requestAudits,
  requestErrorLogs,
  teams,
  upstreamCredentials,
} from "../../db/schema/index.js";
import { resolveLogTeamIds } from "../../lib/org.js";
import { groupDiscoveredModelsByChannel } from "../../lib/discovered-models.js";
import {
  addCalendarDays,
  hasTimePart,
  zonedDayStart,
  zonedInstant,
} from "../../lib/quota-time.js";
import {
  computeRequestCreditBreakdown,
  defaultCreditRateFor,
  requestCreditDiscount,
  tokenBreakdownFromUsage,
} from "../../lib/relay/credit-cost.js";
import {
  findRequestContextFile,
  readRequestContextForDetail,
  readRequestContextRecord,
  REQUEST_CONTEXT_ID_PATTERN,
} from "../../lib/relay/request-context.js";
import {
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

const compareOp = z.enum(["gt", "lt"]);
const optionalNonNegInt = z.coerce.number().int().min(0).optional();

function appendCompare(
  conditions: SQL[],
  column: typeof requestAudits.totalTokens,
  op: z.infer<typeof compareOp> | undefined,
  value: number | undefined,
) {
  if (!op || value == null) return;
  conditions.push(op === "gt" ? gt(column, value) : lt(column, value));
}

function consumptionFor(row: {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens: number | null;
  clientModel: string;
  createdAt: Date;
  startedAt: Date | null;
  requestCredits: string | null;
}) {
  const rate = defaultCreditRateFor(row.clientModel);
  // 与结算同口径：按 [startedAt, createdAt] 区间加权；旧行没有 started_at 时回退为按结束时刻估算
  const startedAt = row.startedAt ?? row.createdAt;
  const creditBreakdown = computeRequestCreditBreakdown(
    {
      promptTokens: row.promptTokens ?? 0,
      completionTokens: row.completionTokens ?? 0,
      cacheReadTokens: row.cacheReadTokens ?? 0,
    },
    rate,
    startedAt,
    row.createdAt,
  );
  const settledCredits = row.requestCredits != null ? Number(row.requestCredits) : null;
  return {
    tokenBreakdown: tokenBreakdownFromUsage(row),
    creditDiscount: rate ? requestCreditDiscount(startedAt, row.createdAt) : null,
    creditBreakdown:
      settledCredits != null && Number.isFinite(settledCredits)
        ? { ...creditBreakdown, total: settledCredits }
        : creditBreakdown,
    credits: settledCredits ?? creditBreakdown.total,
  };
}

/**
 * 模型筛选项：与超管「模型列表」(/api/admin/model-prices)同源的 discovered 目录，
 * 列表里有多少就显示多少；variants 附带渠道前缀写法供日志精确匹配。
 */
async function adminLogModelOptions() {
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
    .leftJoin(upstreamCredentials, eq(upstreamCredentials.productLineId, productLines.id));

  const byModel = new Map<string, Set<string>>();
  for (const channel of groupDiscoveredModelsByChannel(channelRows)) {
    for (const model of channel.models) {
      const prefixes = byModel.get(model) ?? new Set<string>();
      prefixes.add(channel.providerCode);
      byModel.set(model, prefixes);
    }
  }
  return [...byModel.entries()]
    .map(([model, prefixes]) => ({
      model,
      variants: [model, ...[...prefixes].map((code) => `${code}/${model}`)],
    }))
    .sort((left, right) => left.model.localeCompare(right.model));
}

export async function adminLogRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requireRoles("admin"));

  // 模型筛选项：全站「模型列表」同源目录，不从调用记录里去重
  app.get("/api/admin/log-models", async () => {
    return { success: true, data: { models: await adminLogModelOptions() } };
  });

  app.get("/api/admin/logs", async (req, reply) => {
    const parsed = z
      .object({
        limit: z.coerce.number().min(1).max(200).default(50),
        offset: z.coerce.number().min(0).default(0),
        enterpriseId: z.coerce.number().int().positive().optional(),
        departmentId: z.coerce.number().int().positive().optional(),
        teamId: z.coerce.number().int().positive().optional(),
        employeeId: z.coerce.number().int().positive().optional(),
        model: z.string().optional(),
        providerCode: z.string().optional(),
        status: z.string().optional(),
        requestId: z.string().optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}:\d{2})?$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}:\d{2})?$/).optional(),
        tokensOp: compareOp.optional(),
        tokens: optionalNonNegInt,
      })
      .safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const query = parsed.data;

    const conditions: SQL[] = [];

    if (query.enterpriseId) {
      conditions.push(eq(employees.enterpriseId, query.enterpriseId));
    }
    const teamIds = await resolveLogTeamIds({
      departmentId: query.departmentId,
      teamId: query.teamId,
      enterpriseId: query.enterpriseId,
    });
    if (teamIds) {
      if (teamIds.length === 0) conditions.push(sql`false`);
      else conditions.push(inArray(requestAudits.teamId, teamIds));
    }
    if (query.employeeId) {
      conditions.push(eq(requestAudits.employeeId, query.employeeId));
    }
    if (query.model) {
      const match = (await adminLogModelOptions()).find((row) => row.model === query.model);
      conditions.push(
        inArray(requestAudits.clientModel, match ? match.variants : [query.model]),
      );
    }
    if (query.providerCode) conditions.push(eq(requestAudits.providerCode, query.providerCode));
    if (query.status) {
      conditions.push(eq(requestAudits.status, query.status as "success"));
    }
    if (query.requestId) conditions.push(eq(requestAudits.requestId, query.requestId));
    // from/to 支持到秒：带时间部分按精确时刻，纯日期按整天（含当天），
    // 与 /api/me/logs 同口径（按 QUOTA_TIMEZONE 换算，不用裸 new Date 解析）
    if (query.from || query.to) {
      const fromValue = query.from ?? query.to!;
      const toValue = query.to ?? query.from!;
      const rangeStart = zonedInstant(fromValue, env.QUOTA_TIMEZONE);
      if (!rangeStart) {
        return reply.code(400).send({ success: false, message: "参数无效" });
      }
      const rangeEnd = hasTimePart(toValue)
        ? zonedInstant(toValue, env.QUOTA_TIMEZONE)
        : zonedDayStart(addCalendarDays(toValue, 1), env.QUOTA_TIMEZONE);
      if (!rangeEnd || rangeStart.getTime() >= rangeEnd.getTime()) {
        return reply.code(400).send({ success: false, message: "参数无效" });
      }
      conditions.push(gte(requestAudits.createdAt, rangeStart));
      conditions.push(lt(requestAudits.createdAt, rangeEnd));
    }
    appendCompare(conditions, requestAudits.totalTokens, query.tokensOp, query.tokens);

    const whereExpr = conditions.length ? and(...conditions) : undefined;

    const [countRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(requestAudits)
      .innerJoin(employees, eq(requestAudits.employeeId, employees.id))
      .where(whereExpr);

    const items = await db
      .select({
        id: requestAudits.id,
        requestId: requestAudits.requestId,
        employeeId: employees.id,
        employeeName: employees.name,
        enterpriseName: enterprises.name,
        departmentName: departments.name,
        teamName: teams.name,
        clientModel: requestAudits.clientModel,
        providerCode: requestAudits.providerCode,
        productType: requestAudits.productType,
        status: requestAudits.status,
        promptTokens: requestAudits.promptTokens,
        completionTokens: requestAudits.completionTokens,
        totalTokens: requestAudits.totalTokens,
        cacheReadTokens: requestAudits.cacheReadTokens,
        startedAt: requestAudits.startedAt,
        requestCredits: requestAudits.requestCredits,
        createdAt: requestAudits.createdAt,
      })
      .from(requestAudits)
      .innerJoin(employees, eq(requestAudits.employeeId, employees.id))
      .leftJoin(enterprises, eq(employees.enterpriseId, enterprises.id))
      .leftJoin(teams, eq(requestAudits.teamId, teams.id))
      .leftJoin(departments, eq(teams.departmentId, departments.id))
      .where(whereExpr)
      .orderBy(desc(requestAudits.createdAt), desc(requestAudits.id))
      .limit(query.limit)
      .offset(query.offset);

    return {
      success: true,
      data: {
        total: countRow?.n ?? 0,
        items: items.map((row) => ({
          ...row,
          ...consumptionFor(row),
        })),
      },
    };
  });

  app.get("/api/admin/logs/:requestId", async (req, reply) => {
    const params = z
      .object({ requestId: z.string().regex(REQUEST_CONTEXT_ID_PATTERN) })
      .safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const [row] = await db
      .select({
        id: requestAudits.id,
        requestId: requestAudits.requestId,
        employeeId: employees.id,
        employeeName: employees.name,
        employeePhone: employees.phone,
        enterpriseName: enterprises.name,
        departmentName: departments.name,
        teamName: teams.name,
        clientModel: requestAudits.clientModel,
        providerCode: requestAudits.providerCode,
        productLineId: requestAudits.productLineId,
        productType: requestAudits.productType,
        credentialId: requestAudits.credentialId,
        status: requestAudits.status,
        promptTokens: requestAudits.promptTokens,
        completionTokens: requestAudits.completionTokens,
        totalTokens: requestAudits.totalTokens,
        cacheReadTokens: requestAudits.cacheReadTokens,
        startedAt: requestAudits.startedAt,
        requestCredits: requestAudits.requestCredits,
        createdAt: requestAudits.createdAt,
      })
      .from(requestAudits)
      .innerJoin(employees, eq(requestAudits.employeeId, employees.id))
      .leftJoin(enterprises, eq(employees.enterpriseId, enterprises.id))
      .leftJoin(teams, eq(requestAudits.teamId, teams.id))
      .leftJoin(departments, eq(teams.departmentId, departments.id))
      .where(eq(requestAudits.requestId, params.data.requestId))
      .limit(1);
    if (!row) {
      return reply.code(404).send({ success: false, message: "调用记录不存在" });
    }

    const [errorRow] = await db
      .select({
        httpStatus: requestErrorLogs.httpStatus,
        upstreamStatus: requestErrorLogs.upstreamStatus,
        errorCode: requestErrorLogs.errorCode,
        errorMessage: requestErrorLogs.errorMessage,
      })
      .from(requestErrorLogs)
      .where(eq(requestErrorLogs.requestId, row.requestId))
      .limit(1);

    const filePath = await findRequestContextFile(
      env.REQUEST_CONTEXT_DIR,
      env.QUOTA_TIMEZONE,
      row.requestId,
      row.createdAt,
      row.employeeId,
    );
    let context: unknown = null;
    let omittedBodies = false;
    if (filePath) {
      try {
        const summarized = await readRequestContextForDetail(filePath);
        context = summarized.context;
        omittedBodies = summarized.omittedBodies;
      } catch {
        context = null;
      }
    }

    return {
      success: true,
      data: {
        ...row,
        ...consumptionFor(row),
        error: errorRow ?? null,
        hasContextFile: Boolean(filePath),
        omittedBodies,
        context,
      },
    };
  });

  app.get("/api/admin/logs/:requestId/context", async (req, reply) => {
    const params = z
      .object({ requestId: z.string().regex(REQUEST_CONTEXT_ID_PATTERN) })
      .safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const [row] = await db
      .select({
        requestId: requestAudits.requestId,
        employeeId: requestAudits.employeeId,
        createdAt: requestAudits.createdAt,
      })
      .from(requestAudits)
      .where(eq(requestAudits.requestId, params.data.requestId))
      .limit(1);
    if (!row) {
      return reply.code(404).send({ success: false, message: "调用记录不存在" });
    }

    const filePath = await findRequestContextFile(
      env.REQUEST_CONTEXT_DIR,
      env.QUOTA_TIMEZONE,
      row.requestId,
      row.createdAt,
      row.employeeId,
    );
    if (!filePath) {
      return reply.code(404).send({ success: false, message: "该请求没有全文记录" });
    }

    // contextFormat 2 envelopes hydrate refs (content store) back into the
    // exact JSON shape the model saw; legacy files pass through unchanged.
    const hydrated = await readRequestContextRecord(filePath);
    reply.header("content-type", "application/json; charset=utf-8");
    reply.header(
      "content-disposition",
      `attachment; filename="${row.requestId}.json"`,
    );
    return reply.send(JSON.stringify(hydrated));
  });
}
