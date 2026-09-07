import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  credentialBindings,
  departments,
  employeeApiKeys,
  employees,
  enterprises,
  productLines,
  providers,
  teamMembers,
  teams,
  upstreamCredentials,
} from "../../db/schema/index.js";
import { effectiveCredentialStatus } from "../../lib/credential-status.js";
import { snapshotRelayLiveLoad } from "../../lib/relay/credential-load.js";
import {
  buildKeyBindingGraph,
  usageTierForKeyBindingGraph,
  type KeyBindingCredentialBinding,
  type KeyBindingScopeType,
} from "../../lib/key-binding-graph.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import {
  loadBindingEnterpriseId,
  releaseCredentialBinding,
} from "../../lib/relay/binding.js";
import {
  evaluateCredentialQuota,
  getCredentialQuotaUsage,
  resolveGraphCoolingKind,
} from "../../lib/relay/credential-quota.js";
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
  app.addHook("preHandler", requireRoles("admin", "org_admin"));

  app.get("/api/admin/key-bindings", async (req, reply) => {
    const query = querySchema.safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const scopedEnterpriseId = resolveActorEnterpriseFilter(
      req.session?.role,
      req.session?.enterpriseId,
      query.data.enterpriseId,
    );
    if (scopedEnterpriseId === "forbidden") {
      return reply.code(403).send({ success: false, message: "权限不足" });
    }

    const now = new Date();
    const [keyRows, credentialRows, bindingRows, membershipRows] = await Promise.all([
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
          teamIsDefault: teams.isDefault,
          departmentId: teams.departmentId,
          departmentName: departments.name,
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
        .leftJoin(departments, eq(teams.departmentId, departments.id))
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
          teamIsDefault: teams.isDefault,
          departmentId: teams.departmentId,
          departmentName: departments.name,
        })
        .from(teamMembers)
        .innerJoin(teams, eq(teamMembers.teamId, teams.id))
        .leftJoin(departments, eq(teams.departmentId, departments.id)),
    ]);

    const membershipByEmployee = new Map(
      membershipRows.map((row) => [row.employeeId, row]),
    );
    const employeesById = new Map<
      number,
      {
        id: number;
        name: string;
        enterpriseId: number | null;
        enterpriseName: string | null;
        departmentId: number | null;
        departmentName: string | null;
        teamId: number | null;
        teamName: string | null;
        teamIsDefault: boolean;
        usageTier: ReturnType<typeof usageTierForKeyBindingGraph>;
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
        departmentId: membership?.departmentId ?? row.departmentId,
        departmentName: membership?.departmentName ?? row.departmentName,
        teamId: membership?.teamId ?? row.teamId,
        teamName: membership?.teamName ?? row.teamName,
        teamIsDefault: membership?.teamIsDefault ?? row.teamIsDefault ?? false,
        usageTier: usageTierForKeyBindingGraph(row.usageTier),
      });
    }

    const usageById = await getCredentialQuotaUsage(
      credentialRows.map((row) => row.id),
      now,
    );
    const bindingViewById = await loadCredentialBindingViews(bindingRows);

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
          fiveHourCredits: quota.fiveHourCredits,
          weeklyCredits: quota.weeklyCredits,
          fiveHourLimit: quota.fiveHourLimit,
          weeklyLimit: quota.weeklyLimit,
          binding: bindingViewById.get(row.id) ?? null,
        };
      }),
      bindings: bindingRows,
      filter: {
        productLineId: query.data.productLineId,
        enterpriseId: scopedEnterpriseId,
        q: query.data.q,
      },
    });

    return { success: true, data: graph };
  });

  app.get("/api/admin/key-bindings/live", async () => {
    return { success: true, data: snapshotRelayLiveLoad() };
  });

  app.post("/api/admin/key-bindings/credentials/:id/release", async (req, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }

    const credentialId = params.data.id;
    const [locator] = await db
      .select({
        credentialId: credentialBindings.credentialId,
        scopeType: credentialBindings.scopeType,
        scopeId: credentialBindings.scopeId,
      })
      .from(credentialBindings)
      .where(eq(credentialBindings.credentialId, credentialId))
      .limit(1);
    if (!locator) {
      return reply.code(409).send({
        success: false,
        message: "该渠道 Key 当前没有可释放的绑定",
      });
    }

    if (req.session?.role === "org_admin") {
      if (req.session.enterpriseId == null) {
        return reply.code(403).send({ success: false, message: "权限不足" });
      }
      const bindingEnterpriseId = await loadBindingEnterpriseId({
        scopeType: locator.scopeType,
        scopeId: locator.scopeId,
      });
      if (bindingEnterpriseId !== req.session.enterpriseId) {
        return reply.code(403).send({ success: false, message: "权限不足" });
      }
    }

    const released = await releaseCredentialBinding(credentialId);
    if (!released) {
      return reply.code(409).send({
        success: false,
        message: "该渠道 Key 当前没有可释放的绑定",
      });
    }

    await writeOpsAudit({
      actorEmployeeId: req.employeeId,
      action: "credential.release_binding",
      targetType: "upstream_credential",
      targetId: String(credentialId),
      detail: {
        productLineId: released.productLineId,
        scopeType: released.scopeType,
        scopeId: released.scopeId,
      },
      ip: req.ip,
    });

    return {
      success: true,
      data: {
        credentialId: released.credentialId,
        productLineId: released.productLineId,
        scopeType: released.scopeType,
        scopeId: released.scopeId,
      },
    };
  });
}

export function resolveActorEnterpriseFilter(
  role: string | undefined,
  actorEnterpriseId: number | null | undefined,
  requestedEnterpriseId: number | undefined,
): number | undefined | "forbidden" {
  if (role === "org_admin") {
    if (actorEnterpriseId == null) return "forbidden";
    if (requestedEnterpriseId != null && requestedEnterpriseId !== actorEnterpriseId) {
      return "forbidden";
    }
    return actorEnterpriseId;
  }
  return requestedEnterpriseId;
}

async function loadCredentialBindingViews(
  bindings: readonly {
    credentialId: number;
    scopeType: KeyBindingScopeType;
    scopeId: number;
  }[],
): Promise<Map<number, KeyBindingCredentialBinding>> {
  const views = new Map<number, KeyBindingCredentialBinding>();
  if (bindings.length === 0) return views;

  const rows = await db
    .select({
      credentialId: credentialBindings.credentialId,
      scopeType: credentialBindings.scopeType,
      scopeId: credentialBindings.scopeId,
      employeeName: employees.name,
      teamName: teams.name,
      departmentName: departments.name,
      enterpriseName: enterprises.name,
    })
    .from(credentialBindings)
    .leftJoin(
      employees,
      and(
        eq(credentialBindings.scopeType, "employee"),
        eq(employees.id, credentialBindings.scopeId),
      ),
    )
    .leftJoin(
      teams,
      and(
        eq(credentialBindings.scopeType, "team"),
        eq(teams.id, credentialBindings.scopeId),
      ),
    )
    .leftJoin(
      departments,
      and(
        eq(credentialBindings.scopeType, "department"),
        eq(departments.id, credentialBindings.scopeId),
      ),
    )
    .leftJoin(
      enterprises,
      and(
        eq(credentialBindings.scopeType, "enterprise"),
        eq(enterprises.id, credentialBindings.scopeId),
      ),
    )
    .where(inArray(credentialBindings.credentialId, bindings.map((row) => row.credentialId)));

  for (const row of rows) {
    views.set(row.credentialId, {
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      scopeName: row.employeeName ?? row.departmentName ?? row.teamName ?? row.enterpriseName ?? "",
    });
  }
  return views;
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
