import type { FastifyInstance } from "fastify";
import { count, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  employees,
  modelRoutes,
  providers,
  requestAudits,
  usageCountersDaily,
} from "../../db/schema/index.js";
import { getChannelOverviewStats } from "../../lib/channel-overview.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

export async function adminOverviewRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin"));

  app.get("/api/admin/overview", async () => {
    const now = new Date();
    const [userCount] = await db.select({ n: count() }).from(employees);
    const [activeUsers] = await db
      .select({ n: count() })
      .from(employees)
      .where(eq(employees.status, "active"));
    const channels = await getChannelOverviewStats(now);
    const [providerCount] = await db.select({ n: count() }).from(providers);
    const [routeCount] = await db
      .select({ n: count() })
      .from(modelRoutes)
      .where(eq(modelRoutes.enabled, true));

    const [todayReqs] = await db
      .select({ n: count() })
      .from(requestAudits)
      .where(sql`${requestAudits.createdAt}::date = current_date`);
    const [todayTokens] = await db
      .select({
        tokens: sql<number>`coalesce(sum(${requestAudits.totalTokens}), 0)`,
      })
      .from(requestAudits)
      .where(sql`${requestAudits.createdAt}::date = current_date`);
    const [todayErrors] = await db
      .select({ n: count() })
      .from(requestAudits)
      .where(
        sql`${requestAudits.createdAt}::date = current_date and ${requestAudits.status} <> 'success'`,
      );

    const topUsers = await db
      .select({
        employeeId: usageCountersDaily.employeeId,
        name: employees.name,
        phone: employees.phone,
        totalTokens: usageCountersDaily.totalTokens,
        requestCount: usageCountersDaily.requestCount,
      })
      .from(usageCountersDaily)
      .innerJoin(employees, eq(usageCountersDaily.employeeId, employees.id))
      .where(sql`${usageCountersDaily.day} = current_date`)
      .orderBy(desc(usageCountersDaily.totalTokens))
      .limit(10);

    const byProvider = await db
      .select({
        providerCode: requestAudits.providerCode,
        requests: sql<number>`count(*)::int`,
        tokens: sql<number>`coalesce(sum(${requestAudits.totalTokens}), 0)`,
      })
      .from(requestAudits)
      .where(sql`${requestAudits.createdAt}::date = current_date`)
      .groupBy(requestAudits.providerCode)
      .orderBy(sql`count(*) desc`);

    const recentErrors = await db
      .select({
        requestId: requestAudits.requestId,
        employeeId: requestAudits.employeeId,
        employeeName: employees.name,
        clientModel: requestAudits.clientModel,
        providerCode: requestAudits.providerCode,
        status: requestAudits.status,
        errorCode: requestAudits.errorCode,
        errorMessage: requestAudits.errorMessage,
        createdAt: requestAudits.createdAt,
      })
      .from(requestAudits)
      .innerJoin(employees, eq(requestAudits.employeeId, employees.id))
      .where(sql`${requestAudits.status} <> 'success'`)
      .orderBy(desc(requestAudits.id))
      .limit(10);

    return {
      success: true,
      data: {
        employees: { total: userCount.n, active: activeUsers.n },
        channels,
        providers: providerCount.n,
        modelRoutesEnabled: routeCount.n,
        today: {
          requests: todayReqs.n,
          tokens: Number(todayTokens.tokens ?? 0),
          errors: todayErrors.n,
        },
        topUsersToday: topUsers,
        byProviderToday: byProvider,
        recentErrors,
      },
    };
  });
}
