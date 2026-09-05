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
import { listAdminDepartmentIds, listAdminTeamIds, listTeamIdsInDepartments } from "../../lib/org.js";
import { REQUEST_CONTEXT_ID_PATTERN } from "../../lib/relay/request-context.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(10),
  offset: z.coerce.number().min(0).default(0),
  requestId: z.string().trim().min(1).max(96).optional(),
  employeeId: z.coerce.number().int().positive().optional(),
  errorCode: z.string().trim().max(64).optional(),
  status: z.enum(["upstream_error", "client_error", "cancelled"]).optional(),
  enterpriseId: z.coerce.number().int().positive().optional(),
  teamId: z.coerce.number().int().positive().optional(),
});

export type ErrorLogListInput = {
  limit: number;
  offset: number;
  enterpriseId?: number;
  teamIds?: number[];
  employeeId?: number;
  requestId?: string;
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
  if (input.employeeId) conditions.push(eq(requestErrorLogs.employeeId, input.employeeId));
  if (input.requestId) conditions.push(eq(requestErrorLogs.requestId, input.requestId));
  if (input.errorCode) conditions.push(eq(requestErrorLogs.errorCode, input.errorCode));
  if (input.status) conditions.push(eq(requestErrorLogs.status, input.status));
  return conditions.length ? and(...conditions) : undefined;
}

export function buildErrorLogListQuery(input: ErrorLogListInput) {
  const whereExpr = listWhere(input);
  return db
    .select({
      id: requestErrorLogs.id,
      requestId: requestErrorLogs.requestId,
      employeeId: employees.id,
      employeeName: employees.name,
      enterpriseName: enterprises.name,
      teamName: teams.name,
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

async function resolveListScope(
  role: string,
  session: { enterpriseId: number | null },
  employeeId: number | undefined,
  query: z.infer<typeof listQuerySchema>,
): Promise<ErrorLogListInput | { forbidden: true }> {
  const input: ErrorLogListInput = {
    limit: query.limit,
    offset: query.offset,
    employeeId: query.employeeId,
    requestId: query.requestId,
    errorCode: query.errorCode,
    status: query.status,
  };

  if (role === "org_admin") {
    if (session.enterpriseId == null) return { forbidden: true };
    input.enterpriseId = session.enterpriseId;
    if (query.teamId != null) input.teamIds = [query.teamId];
    return input;
  }
  if (role === "dept_admin") {
    input.teamIds = await listTeamIdsInDepartments(await listAdminDepartmentIds(employeeId!));
    return input;
  }
  if (role === "team_admin") {
    input.teamIds = await listAdminTeamIds(employeeId!);
    return input;
  }
  input.enterpriseId = query.enterpriseId;
  input.teamIds = query.teamId != null ? [query.teamId] : undefined;
  return input;
}

export async function adminErrorLogRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin", "org_admin", "dept_admin", "team_admin"));

  app.get("/api/admin/error-logs", async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const input = await resolveListScope(
      req.session!.role,
      { enterpriseId: req.session!.enterpriseId },
      req.employeeId,
      parsed.data,
    );
    if ("forbidden" in input) {
      return reply.code(403).send({ success: false, message: "权限不足" });
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

  app.get("/api/admin/error-logs/:requestId", async (req, reply) => {
    const params = z
      .object({ requestId: z.string().regex(REQUEST_CONTEXT_ID_PATTERN) })
      .safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const [row] = await db
      .select({
        id: requestErrorLogs.id,
        requestId: requestErrorLogs.requestId,
        employeeId: employees.id,
        employeeName: employees.name,
        employeePhone: employees.phone,
        employeeDept: employees.dept,
        enterpriseId: employees.enterpriseId,
        enterpriseName: enterprises.name,
        teamId: requestErrorLogs.teamId,
        teamName: teams.name,
        clientModel: requestErrorLogs.clientModel,
        providerCode: requestErrorLogs.providerCode,
        productLineId: requestErrorLogs.productLineId,
        productType: requestErrorLogs.productType,
        credentialId: requestErrorLogs.credentialId,
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
      .where(eq(requestErrorLogs.requestId, params.data.requestId))
      .limit(1);
    if (!row) {
      return reply.code(404).send({ success: false, message: "报错记录不存在" });
    }

    const role = req.session!.role;
    if (role === "org_admin") {
      if (req.session!.enterpriseId == null || row.enterpriseId !== req.session!.enterpriseId) {
        return reply.code(403).send({ success: false, message: "权限不足" });
      }
    } else if (role === "team_admin") {
      const teamIds = await listAdminTeamIds(req.employeeId!);
      if (row.teamId == null || !teamIds.includes(row.teamId)) {
        return reply.code(403).send({ success: false, message: "权限不足" });
      }
    }

    return {
      success: true,
      data: row,
    };
  });
}
