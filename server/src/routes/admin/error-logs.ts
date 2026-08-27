import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  employees,
  enterprises,
  requestErrorLogs,
  teams,
} from "../../db/schema/index.js";
import { listAdminTeamIds } from "../../lib/org.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().min(0).default(0),
  errorCode: z.string().trim().max(64).optional(),
  status: z.enum(["upstream_error", "client_error", "cancelled"]).optional(),
  enterpriseId: z.coerce.number().int().positive().optional(),
  teamId: z.coerce.number().int().positive().optional(),
});

export type ErrorLogListInput = {
  limit: number;
  offset: number;
  includeEmployee: boolean;
  enterpriseId?: number;
  teamIds?: number[];
  errorCode?: string;
  status?: "upstream_error" | "client_error" | "cancelled";
};

function listWhere(input: ErrorLogListInput) {
  const conditions: SQL[] = [];
  if (input.enterpriseId != null) {
    conditions.push(eq(employees.enterpriseId, input.enterpriseId));
  }
  if (input.teamIds) {
    if (input.teamIds.length === 0) conditions.push(sql`false`);
    else conditions.push(inArray(requestErrorLogs.teamId, input.teamIds));
  }
  if (input.errorCode) conditions.push(eq(requestErrorLogs.errorCode, input.errorCode));
  if (input.status) conditions.push(eq(requestErrorLogs.status, input.status));
  return conditions.length ? and(...conditions) : undefined;
}

const employeeColumns = {
  employeeName: employees.name,
  employeeDept: employees.dept,
};

export function buildErrorLogListQuery(input: ErrorLogListInput) {
  const whereExpr = listWhere(input);
  return db
    .select({
      id: requestErrorLogs.id,
      requestId: requestErrorLogs.requestId,
      enterpriseName: enterprises.name,
      teamName: teams.name,
      ...(input.includeEmployee ? employeeColumns : {}),
      clientModel: requestErrorLogs.clientModel,
      providerCode: requestErrorLogs.providerCode,
      productType: requestErrorLogs.productType,
      status: requestErrorLogs.status,
      httpStatus: requestErrorLogs.httpStatus,
      upstreamStatus: requestErrorLogs.upstreamStatus,
      errorCode: requestErrorLogs.errorCode,
      errorMessage: requestErrorLogs.errorMessage,
      createdAt: requestErrorLogs.createdAt,
    })
    .from(requestErrorLogs)
    .innerJoin(employees, eq(requestErrorLogs.employeeId, employees.id))
    .leftJoin(enterprises, eq(employees.enterpriseId, enterprises.id))
    .leftJoin(teams, eq(requestErrorLogs.teamId, teams.id))
    .where(whereExpr)
    .orderBy(desc(requestErrorLogs.createdAt), desc(requestErrorLogs.id))
    .limit(input.limit)
    .offset(input.offset);
}

export async function adminErrorLogRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin", "org_admin", "team_admin"));

  app.get("/api/admin/error-logs", async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const role = req.session!.role;
    const input: ErrorLogListInput = {
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      includeEmployee: role !== "admin",
      errorCode: parsed.data.errorCode,
      status: parsed.data.status,
    };

    if (role === "org_admin") {
      if (req.session!.enterpriseId == null) {
        return reply.code(403).send({ success: false, message: "权限不足" });
      }
      input.enterpriseId = req.session!.enterpriseId;
      if (parsed.data.teamId != null) input.teamIds = [parsed.data.teamId];
    } else if (role === "team_admin") {
      input.teamIds = await listAdminTeamIds(req.employeeId!);
    } else {
      input.enterpriseId = parsed.data.enterpriseId;
      input.teamIds = parsed.data.teamId != null ? [parsed.data.teamId] : undefined;
    }

    const whereExpr = listWhere(input);
    const [countRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(requestErrorLogs)
      .innerJoin(employees, eq(requestErrorLogs.employeeId, employees.id))
      .where(whereExpr);

    const items = await buildErrorLogListQuery(input);

    return {
      success: true,
      data: {
        total: countRow?.n ?? 0,
        items,
      },
    };
  });
}
