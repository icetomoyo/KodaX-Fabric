import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import type { FastifyInstance } from "fastify";
import { and, desc, eq, gt, gte, lt, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import {
  employees,
  enterprises,
  requestAudits,
  requestErrorLogs,
  teams,
} from "../../db/schema/index.js";
import { computeRequestCredits, defaultCreditRateFor } from "../../lib/relay/credit-cost.js";
import {
  findRequestContextFile,
  readRequestContextRecord,
  REQUEST_CONTEXT_ID_PATTERN,
  summarizeRequestContextForDetail,
} from "../../lib/relay/request-context.js";
import {
  requirePasswordChanged,
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

function creditsFor(row: {
  promptTokens: number | null;
  completionTokens: number | null;
  cacheReadTokens: number | null;
  clientModel: string;
  createdAt: Date;
}): number {
  return computeRequestCredits(
    {
      promptTokens: row.promptTokens ?? 0,
      completionTokens: row.completionTokens ?? 0,
      cacheReadTokens: row.cacheReadTokens ?? 0,
    },
    defaultCreditRateFor(row.clientModel),
    row.createdAt,
  );
}

export async function adminLogRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin"));

  app.get("/api/admin/logs", async (req) => {
    const query = z
      .object({
        limit: z.coerce.number().min(1).max(200).default(50),
        offset: z.coerce.number().min(0).default(0),
        enterpriseId: z.coerce.number().int().positive().optional(),
        teamId: z.coerce.number().int().positive().optional(),
        employeeId: z.coerce.number().int().positive().optional(),
        model: z.string().optional(),
        providerCode: z.string().optional(),
        status: z.string().optional(),
        requestId: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        tokensOp: compareOp.optional(),
        tokens: optionalNonNegInt,
      })
      .parse(req.query);

    const conditions: SQL[] = [];

    if (query.enterpriseId) {
      conditions.push(eq(employees.enterpriseId, query.enterpriseId));
    }
    if (query.teamId) {
      conditions.push(eq(requestAudits.teamId, query.teamId));
    }
    if (query.employeeId) {
      conditions.push(eq(requestAudits.employeeId, query.employeeId));
    }
    if (query.model) conditions.push(eq(requestAudits.clientModel, query.model));
    if (query.providerCode) conditions.push(eq(requestAudits.providerCode, query.providerCode));
    if (query.status) {
      conditions.push(eq(requestAudits.status, query.status as "success"));
    }
    if (query.requestId) conditions.push(eq(requestAudits.requestId, query.requestId));
    if (query.from) conditions.push(gte(requestAudits.createdAt, new Date(query.from)));
    if (query.to) conditions.push(lte(requestAudits.createdAt, new Date(query.to)));
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
        teamName: teams.name,
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
      .innerJoin(employees, eq(requestAudits.employeeId, employees.id))
      .leftJoin(enterprises, eq(employees.enterpriseId, enterprises.id))
      .leftJoin(teams, eq(requestAudits.teamId, teams.id))
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
          credits: creditsFor(row),
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
        createdAt: requestAudits.createdAt,
      })
      .from(requestAudits)
      .innerJoin(employees, eq(requestAudits.employeeId, employees.id))
      .leftJoin(enterprises, eq(employees.enterpriseId, enterprises.id))
      .leftJoin(teams, eq(requestAudits.teamId, teams.id))
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
    );
    let context: unknown = null;
    let omittedBodies = false;
    if (filePath) {
      try {
        const summarized = summarizeRequestContextForDetail(
          await readRequestContextRecord(filePath),
        );
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
        credits: creditsFor(row),
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
    );
    if (!filePath) {
      return reply.code(404).send({ success: false, message: "该请求没有全文记录" });
    }

    reply.header("content-type", "application/json; charset=utf-8");
    reply.header(
      "content-disposition",
      `attachment; filename="${row.requestId}.json"`,
    );
    return reply.send(createReadStream(filePath).pipe(createGunzip()));
  });
}
