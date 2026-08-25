import type { FastifyInstance } from "fastify";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  employeeApiKeys,
  employees,
  enterprises,
  modelRoutes,
  opsAuditLogs,
  productLines,
  providers,
  requestAudits,
  teams,
  upstreamCredentials,
} from "../../db/schema/index.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

export async function adminOpsAuditRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin"));

  app.get("/api/admin/ops-audit", async (req) => {
    const query = z
      .object({
        limit: z.coerce.number().min(1).max(200).default(50),
        offset: z.coerce.number().min(0).default(0),
        action: z.string().optional(),
        actorEmployeeId: z.coerce.number().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse(req.query);

    const conditions = [];
    if (query.action) conditions.push(eq(opsAuditLogs.action, query.action));
    if (query.actorEmployeeId) {
      conditions.push(eq(opsAuditLogs.actorEmployeeId, query.actorEmployeeId));
    }
    if (query.from) conditions.push(gte(opsAuditLogs.createdAt, new Date(query.from)));
    if (query.to) conditions.push(lte(opsAuditLogs.createdAt, new Date(query.to)));

    const whereExpr = conditions.length ? and(...conditions) : undefined;

    const [countRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(opsAuditLogs)
      .where(whereExpr);

    const items = await db
      .select({
        id: opsAuditLogs.id,
        actorEmployeeId: opsAuditLogs.actorEmployeeId,
        actorName: employees.name,
        actorPhone: employees.phone,
        action: opsAuditLogs.action,
        targetType: opsAuditLogs.targetType,
        targetId: opsAuditLogs.targetId,
        detail: opsAuditLogs.detail,
        ip: opsAuditLogs.ip,
        createdAt: opsAuditLogs.createdAt,
      })
      .from(opsAuditLogs)
      .leftJoin(employees, eq(opsAuditLogs.actorEmployeeId, employees.id))
      .where(whereExpr)
      .orderBy(desc(opsAuditLogs.id))
      .limit(query.limit)
      .offset(query.offset);

    const targetIds = (targetType: string) => [
      ...new Set(
        items
          .filter((item) => item.targetType === targetType && item.targetId)
          .map((item) => item.targetId!),
      ),
    ];
    const numericTargetIds = (targetType: string) =>
      targetIds(targetType)
        .map(Number)
        .filter((id) => Number.isSafeInteger(id) && id > 0);

    const employeeIds = numericTargetIds("employee");
    const employeeApiKeyIds = numericTargetIds("employee_api_key");
    const providerIds = numericTargetIds("provider");
    const productLineIds = numericTargetIds("product_line");
    const credentialIds = numericTargetIds("upstream_credential");
    const modelRouteIds = numericTargetIds("model_route");
    const requestIds = targetIds("request_audit");

    const [
      employeeTargets,
      employeeApiKeyTargets,
      providerTargets,
      productLineTargets,
      credentialTargets,
      modelRouteTargets,
      requestTargets,
    ] = await Promise.all([
      employeeIds.length
        ? db
            .select({ id: employees.id })
            .from(employees)
            .where(inArray(employees.id, employeeIds))
        : [],
      employeeApiKeyIds.length
        ? db
            .select({
              id: employeeApiKeys.id,
              name: employeeApiKeys.name,
            })
            .from(employeeApiKeys)
            .where(inArray(employeeApiKeys.id, employeeApiKeyIds))
        : [],
      providerIds.length
        ? db
            .select({ id: providers.id, name: providers.name })
            .from(providers)
            .where(inArray(providers.id, providerIds))
        : [],
      productLineIds.length
        ? db
            .select({ id: productLines.id, name: productLines.name, providerName: providers.name })
            .from(productLines)
            .innerJoin(providers, eq(productLines.providerId, providers.id))
            .where(inArray(productLines.id, productLineIds))
        : [],
      credentialIds.length
        ? db
            .select({
              id: upstreamCredentials.id,
              label: upstreamCredentials.label,
              secretSuffix: upstreamCredentials.secretSuffix,
              providerName: providers.name,
            })
            .from(upstreamCredentials)
            .innerJoin(productLines, eq(upstreamCredentials.productLineId, productLines.id))
            .innerJoin(providers, eq(productLines.providerId, providers.id))
            .where(inArray(upstreamCredentials.id, credentialIds))
        : [],
      modelRouteIds.length
        ? db
            .select({
              id: modelRoutes.id,
              clientModel: modelRoutes.clientModel,
              upstreamModel: modelRoutes.upstreamModel,
            })
            .from(modelRoutes)
            .where(inArray(modelRoutes.id, modelRouteIds))
        : [],
      requestIds.length
        ? db
            .select({
              requestId: requestAudits.requestId,
              clientModel: requestAudits.clientModel,
              enterpriseName: enterprises.name,
              teamName: teams.name,
            })
            .from(requestAudits)
            .innerJoin(employees, eq(requestAudits.employeeId, employees.id))
            .leftJoin(enterprises, eq(employees.enterpriseId, enterprises.id))
            .leftJoin(teams, eq(requestAudits.teamId, teams.id))
            .where(inArray(requestAudits.requestId, requestIds))
        : [],
    ]);

    const targetNames = new Map<string, string>();
    const setTargetName = (targetType: string, targetId: number | string, name: string) => {
      targetNames.set(`${targetType}:${targetId}`, name);
    };

    for (const row of employeeTargets) {
      setTargetName("employee", row.id, `员工 #${row.id}`);
    }
    for (const row of employeeApiKeyTargets) {
      setTargetName("employee_api_key", row.id, row.name);
    }
    for (const row of providerTargets) setTargetName("provider", row.id, row.name);
    for (const row of productLineTargets) {
      setTargetName("product_line", row.id, `${row.providerName} / ${row.name}`);
    }
    for (const row of credentialTargets) {
      setTargetName(
        "upstream_credential",
        row.id,
        `${row.providerName} / ${row.label}（••••${row.secretSuffix}）`,
      );
    }
    for (const row of modelRouteTargets) {
      setTargetName("model_route", row.id, `${row.clientModel} → ${row.upstreamModel}`);
    }
    for (const row of requestTargets) {
      setTargetName(
        "request_audit",
        row.requestId,
        [row.enterpriseName, row.teamName, row.clientModel].filter(Boolean).join(" / "),
      );
    }

    const enrichedItems = items.map((item) => ({
      ...item,
      targetName:
        item.targetType && item.targetId
          ? targetNames.get(`${item.targetType}:${item.targetId}`) ?? null
          : null,
    }));

    return {
      success: true,
      data: {
        total: countRow?.n ?? 0,
        items: enrichedItems,
      },
    };
  });
}
