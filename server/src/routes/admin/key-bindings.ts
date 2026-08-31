import type { FastifyInstance } from "fastify";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import {
  credentialBindings,
  employeeApiKeys,
  employees,
  enterprises,
  productLines,
  providers,
  teamMembers,
  teams,
  upstreamCredentials,
  usageCountersDaily,
} from "../../db/schema/index.js";
import { effectiveCredentialStatus } from "../../lib/credential-status.js";
import { snapshotRelayLiveLoad } from "../../lib/relay/credential-load.js";
import { buildKeyBindingGraph } from "../../lib/key-binding-graph.js";
import { addCalendarDays, quotaDayAt } from "../../lib/quota-time.js";
import {
  evaluateCredentialQuota,
  getCredentialQuotaUsage,
  resolveGraphCoolingKind,
} from "../../lib/relay/credential-quota.js";
import { effectiveUsageTier } from "../../lib/usage-tier.js";
import {
  requirePasswordChanged,
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

const querySchema = z.object({
  productLineId: z.coerce.number().int().positive().optional(),
  enterpriseId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(100).optional(),
});

export async function adminKeyBindingRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requirePasswordChanged);
  app.addHook("preHandler", requireRoles("admin"));

  app.get("/api/admin/key-bindings", async (req, reply) => {
    const query = querySchema.safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const now = new Date();
    const today = quotaDayAt(now, env.QUOTA_TIMEZONE);
    const usageFrom = addCalendarDays(today, -6);
    const [keyRows, credentialRows, bindingRows, membershipRows, usageRows] = await Promise.all([
      db
        .select({
          id: employeeApiKeys.id,
          employeeId: employeeApiKeys.employeeId,
          name: employeeApiKeys.name,
          keyPrefix: employeeApiKeys.keyPrefix,
          protocol: employeeApiKeys.protocol,
          productLineId: employeeApiKeys.productLineId,
          productLineName: productLines.name,
          teamId: employeeApiKeys.teamId,
          teamName: teams.name,
          status: employeeApiKeys.status,
          employeeName: employees.name,
          usageTier: employees.usageTier,
          enterpriseId: employees.enterpriseId,
          enterpriseName: enterprises.name,
        })
        .from(employeeApiKeys)
        .innerJoin(employees, eq(employeeApiKeys.employeeId, employees.id))
        .innerJoin(productLines, eq(employeeApiKeys.productLineId, productLines.id))
        .leftJoin(teams, eq(employeeApiKeys.teamId, teams.id))
        .leftJoin(enterprises, eq(employees.enterpriseId, enterprises.id)),
      db
        .select({
          id: upstreamCredentials.id,
          label: upstreamCredentials.label,
          secretSuffix: upstreamCredentials.secretSuffix,
          productLineId: upstreamCredentials.productLineId,
          productLineName: productLines.name,
          providerCode: providers.code,
          providerName: providers.name,
          status: upstreamCredentials.status,
          coolUntil: upstreamCredentials.coolUntil,
          fiveHourCreditLimit: upstreamCredentials.fiveHourCreditLimit,
          weeklyCreditLimit: upstreamCredentials.weeklyCreditLimit,
          supportedProtocols: upstreamCredentials.supportedProtocols,
        })
        .from(upstreamCredentials)
        .innerJoin(productLines, eq(upstreamCredentials.productLineId, productLines.id))
        .innerJoin(providers, eq(productLines.providerId, providers.id)),
      db
        .select({
          credentialId: credentialBindings.credentialId,
          scopeType: credentialBindings.scopeType,
          scopeId: credentialBindings.scopeId,
        })
        .from(credentialBindings),
      db
        .select({
          employeeId: teamMembers.employeeId,
          teamId: teams.id,
          teamName: teams.name,
        })
        .from(teamMembers)
        .innerJoin(teams, eq(teamMembers.teamId, teams.id)),
      db
        .select({
          employeeId: usageCountersDaily.employeeId,
          peakTokens: sql<number>`max(${usageCountersDaily.totalTokens})`,
        })
        .from(usageCountersDaily)
        .where(
          and(
            gte(usageCountersDaily.day, usageFrom),
            lte(usageCountersDaily.day, today),
          ),
        )
        .groupBy(usageCountersDaily.employeeId),
    ]);

    const membershipByEmployee = new Map(
      membershipRows.map((row) => [row.employeeId, row]),
    );
    const peakByEmployee = new Map(
      usageRows.map((row) => [row.employeeId, Number(row.peakTokens) || 0]),
    );
    const employeesById = new Map<
      number,
      {
        id: number;
        name: string;
        enterpriseId: number | null;
        enterpriseName: string | null;
        teamId: number | null;
        teamName: string | null;
        usageTier: ReturnType<typeof effectiveUsageTier>;
      }
    >();
    for (const row of keyRows) {
      if (employeesById.has(row.employeeId)) continue;
      const membership = membershipByEmployee.get(row.employeeId);
      employeesById.set(row.employeeId, {
        id: row.employeeId,
        name: row.employeeName,
        enterpriseId: row.enterpriseId,
        enterpriseName: row.enterpriseName,
        teamId: membership?.teamId ?? row.teamId,
        teamName: membership?.teamName ?? row.teamName,
        usageTier: effectiveUsageTier(
          row.usageTier,
          peakByEmployee.get(row.employeeId) ?? null,
        ),
      });
    }

    const usageById = await getCredentialQuotaUsage(
      credentialRows.map((row) => row.id),
      now,
    );

    const graph = buildKeyBindingGraph({
      employees: [...employeesById.values()],
      virtualKeys: keyRows.map((row) => ({
        id: row.id,
        employeeId: row.employeeId,
        name: row.name,
        keyPrefix: row.keyPrefix,
        protocol: row.protocol,
        productLineId: row.productLineId,
        productLineName: row.productLineName,
        teamId: row.teamId,
        teamName: row.teamName,
        status: row.status,
      })),
      credentials: credentialRows.map((row) => {
        const status = effectiveCredentialStatus(row.status, row.coolUntil, now);
        const usage = usageById.get(row.id) ?? { fiveHourCredits: 0, weeklyCredits: 0 };
        const quota = evaluateCredentialQuota(
          usage,
          {
            fiveHourLimit: creditLimitNumber(row.fiveHourCreditLimit),
            weeklyLimit: creditLimitNumber(row.weeklyCreditLimit),
          },
          now,
        );
        const coolingKind = resolveGraphCoolingKind(status, quota);
        return {
          id: row.id,
          label: row.label,
          secretSuffix: row.secretSuffix,
          productLineId: row.productLineId,
          productLineName: row.productLineName,
          providerCode: row.providerCode,
          providerName: row.providerName,
          status,
          coolingKind,
          coolUntil: coolingUntilIso(coolingKind, row.coolUntil, quota.exhaustedUntil),
          supportedProtocols: row.supportedProtocols ?? [],
        };
      }),
      bindings: bindingRows,
      filter: {
        productLineId: query.data.productLineId,
        enterpriseId: query.data.enterpriseId,
        q: query.data.q,
      },
    });

    return { success: true, data: graph };
  });

  app.get("/api/admin/key-bindings/live", async () => {
    return { success: true, data: snapshotRelayLiveLoad() };
  });
}

function creditLimitNumber(value: string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function coolingUntilIso(
  coolingKind: ReturnType<typeof resolveGraphCoolingKind>,
  coolUntil: Date | null,
  exhaustedUntil: Date | null,
): string | null {
  if (!coolingKind) return null;
  const until = coolingKind === "other" ? coolUntil : exhaustedUntil ?? coolUntil;
  return until ? until.toISOString() : null;
}
