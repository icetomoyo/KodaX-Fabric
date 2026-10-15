import type { FastifyInstance } from "fastify";
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  channelSeats,
  credentialBindingMembers,
  credentialBindings,
  departments,
  employeeApiKeys,
  employees,
  enterprises,
  productLines,
  providers,
  requestAudits,
  teams,
  upstreamCredentials,
} from "../../db/schema/index.js";
import { env } from "../../config.js";
import { effectiveCredentialStatus } from "../../lib/credential-status.js";
import { snapshotRelayLiveLoad } from "../../lib/relay/credential-load.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import { releaseCredentialBinding, type BindingScopeType } from "../../lib/relay/binding.js";
import {
  credentialWindowAnchors,
  evaluateCredentialQuota,
  getCredentialQuotaUsage,
  packageCreditLimits,
  resolveGraphCoolingKind,
} from "../../lib/relay/credential-quota.js";
import {
  requireRoles,
  requireSession,
} from "../../middleware/auth.js";

/** 画布可选的「最近有通信」窗口：30 分钟 / 2 小时 / 24 小时。 */
const WINDOW_MINUTES = [30, 120, 1440] as const;

const querySchema = z.object({
  windowMinutes: z.coerce
    .number()
    .int()
    .refine((value) => (WINDOW_MINUTES as readonly number[]).includes(value))
    .default(30),
  productLineId: z.coerce.number().int().positive().optional(),
});

type CredentialBindingView = {
  scopeType: BindingScopeType;
  scopeId: number;
  scopeName: string;
};

export async function adminKeyBindingRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireSession);
  app.addHook("preHandler", requireRoles("admin"));

  /**
   * 调度画布：员工 → 虚拟 Key → 渠道 Key。
   * 连线是窗口内 request_audits 里真实发生过的「虚拟 Key 打到哪把渠道 Key」，
   * 再并上此刻在途、还没落审计的请求；渠道 Key 不论有没有流量全部返回。
   */
  app.get("/api/admin/key-bindings", async (req, reply) => {
    const query = querySchema.safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send({ success: false, message: "参数无效" });
    }
    const { windowMinutes, productLineId } = query.data;
    const now = new Date();
    const since = new Date(now.getTime() - windowMinutes * 60_000);

    const [credentialRows, bindingRows, memberRows, hopRows] = await Promise.all([
      db
        .select({
          id: upstreamCredentials.id,
          label: upstreamCredentials.label,
          secretSuffix: upstreamCredentials.secretSuffix,
          productLineId: upstreamCredentials.productLineId,
          productLineName: productLines.name,
          providerName: providers.name,
          status: upstreamCredentials.status,
          coolUntil: upstreamCredentials.coolUntil,
          fiveHourCreditLimit: productLines.fiveHourCreditLimit,
          weeklyCreditLimit: productLines.weeklyCreditLimit,
          monthlyCreditLimit: productLines.monthlyCreditLimit,
          fiveHourWindowAnchor: upstreamCredentials.fiveHourWindowAnchor,
          fiveHourWindowBaseCredits: upstreamCredentials.fiveHourWindowBaseCredits,
          weeklyWindowResetAt: upstreamCredentials.weeklyWindowResetAt,
          lineWeeklyWindowResetAt: productLines.weeklyWindowResetAt,
          lineMonthlyWindowResetAt: productLines.monthlyWindowResetAt,
          ownerEmployeeId: channelSeats.employeeId,
          ownerName: employees.name,
        })
        .from(upstreamCredentials)
        .innerJoin(productLines, eq(upstreamCredentials.productLineId, productLines.id))
        .innerJoin(providers, eq(productLines.providerId, providers.id))
        .leftJoin(channelSeats, eq(channelSeats.credentialId, upstreamCredentials.id))
        .leftJoin(employees, eq(employees.id, channelSeats.employeeId)),
      db
        .select({
          id: credentialBindings.id,
          credentialId: credentialBindings.credentialId,
          scopeType: credentialBindings.scopeType,
          scopeId: credentialBindings.scopeId,
        })
        .from(credentialBindings),
      db
        .select({ bindingId: credentialBindingMembers.bindingId })
        .from(credentialBindingMembers),
      db
        .select({
          virtualKeyId: requestAudits.employeeApiKeyId,
          credentialId: requestAudits.credentialId,
          requests: sql<number>`count(*)::int`,
          failures: sql<number>`(count(*) filter (where ${requestAudits.status} <> 'success'))::int`,
          credits: sql<string>`coalesce(sum(${requestAudits.requestCredits}), 0)`,
          lastAt: sql<string>`max(${requestAudits.createdAt})`,
        })
        .from(requestAudits)
        .where(
          and(
            gte(requestAudits.createdAt, since),
            isNotNull(requestAudits.employeeApiKeyId),
            isNotNull(requestAudits.credentialId),
          ),
        )
        .groupBy(requestAudits.employeeApiKeyId, requestAudits.credentialId),
    ]);

    const productLineOptions = new Map<number, { id: number; name: string; providerName: string }>();
    for (const row of credentialRows) {
      productLineOptions.set(row.productLineId, {
        id: row.productLineId,
        name: row.productLineName,
        providerName: row.providerName,
      });
    }

    const visibleCredentials = credentialRows.filter(
      (row) => productLineId == null || row.productLineId === productLineId,
    );
    const credentialById = new Map(visibleCredentials.map((row) => [row.id, row]));

    // 窗口内的真实请求，加上此刻在途、审计还没写的请求。
    type Hop = {
      virtualKeyId: number;
      credentialId: number;
      requests: number;
      failures: number;
      credits: number;
      lastAt: string | null;
    };
    const hops = new Map<string, Hop>();
    for (const row of hopRows) {
      if (row.virtualKeyId == null || row.credentialId == null) continue;
      hops.set(`${row.virtualKeyId}:${row.credentialId}`, {
        virtualKeyId: row.virtualKeyId,
        credentialId: row.credentialId,
        requests: Number(row.requests),
        failures: Number(row.failures),
        credits: Number(row.credits),
        lastAt: row.lastAt ? new Date(row.lastAt).toISOString() : null,
      });
    }
    for (const live of snapshotRelayLiveLoad().hops) {
      const id = `${live.virtualKeyId}:${live.credentialId}`;
      if (hops.has(id)) continue;
      hops.set(id, {
        virtualKeyId: live.virtualKeyId,
        credentialId: live.credentialId,
        requests: 0,
        failures: 0,
        credits: 0,
        lastAt: null,
      });
    }
    const scopedHops = [...hops.values()].filter((hop) => credentialById.has(hop.credentialId));

    const keyIds = [...new Set(scopedHops.map((hop) => hop.virtualKeyId))];
    const keyRows = keyIds.length
      ? await db
        .select({
          id: employeeApiKeys.id,
          employeeId: employeeApiKeys.employeeId,
          name: employeeApiKeys.name,
          keyPrefix: employeeApiKeys.keyPrefix,
          protocol: employeeApiKeys.protocol,
          productLineId: employeeApiKeys.productLineId,
          productLineName: productLines.name,
          status: employeeApiKeys.status,
          employeeName: employees.name,
          enterpriseName: enterprises.name,
        })
        .from(employeeApiKeys)
        .innerJoin(employees, eq(employeeApiKeys.employeeId, employees.id))
        .innerJoin(productLines, eq(employeeApiKeys.productLineId, productLines.id))
        .leftJoin(enterprises, eq(employees.enterpriseId, enterprises.id))
        .where(inArray(employeeApiKeys.id, keyIds))
      : [];
    const keyById = new Map(keyRows.map((row) => [row.id, row]));

    const employeesById = new Map<number, { id: number; name: string; enterpriseName: string | null }>();
    for (const row of keyRows) {
      employeesById.set(row.employeeId, {
        id: row.employeeId,
        name: row.employeeName,
        enterpriseName: row.enterpriseName,
      });
    }

    const membersByBinding = new Map<number, number>();
    for (const row of memberRows) {
      membersByBinding.set(row.bindingId, (membersByBinding.get(row.bindingId) ?? 0) + 1);
    }
    const memberCountByCredential = new Map(
      bindingRows.map((row) => [row.credentialId, membersByBinding.get(row.id) ?? 0]),
    );
    const bindingViewById = await loadCredentialBindingViews(bindingRows);
    const usageById = await getCredentialQuotaUsage(
      visibleCredentials.map((row) => row.id),
      now,
      new Map(visibleCredentials.map((row) => [row.id, credentialWindowAnchors(row)])),
    );

    const credentials = visibleCredentials
      .map((row) => {
        const status = effectiveCredentialStatus(row.status, row.coolUntil, now);
        const usage = usageById.get(row.id) ?? { fiveHourCredits: 0, weeklyCredits: 0 };
        const quota = evaluateCredentialQuota(
          usage,
          packageCreditLimits(row),
          now,
          credentialWindowAnchors(row),
          // 画布上的「额度冷却」与调度里借用者让出 Key 的借用线一致。
          {
            fiveHour: env.RELAY_GUEST_FIVE_HOUR_RATIO,
            weekly: env.RELAY_GUEST_WEEKLY_RATIO,
          },
        );
        const coolingKind = resolveGraphCoolingKind(status, quota);
        return {
          id: row.id,
          label: row.label,
          secretSuffix: row.secretSuffix,
          productLineId: row.productLineId,
          productLineName: row.productLineName,
          providerName: row.providerName,
          status,
          coolingKind,
          coolUntil: coolingUntilIso(coolingKind, row.coolUntil, quota.exhaustedUntil),
          fiveHourCredits: quota.fiveHourCredits,
          weeklyCredits: quota.weeklyCredits,
          fiveHourLimit: quota.fiveHourLimit,
          weeklyLimit: quota.weeklyLimit,
          binding: bindingViewById.get(row.id) ?? null,
          memberCount: memberCountByCredential.get(row.id) ?? 0,
          ownerEmployeeId: row.ownerEmployeeId,
          ownerName: row.ownerName,
        };
      })
      .sort((a, b) => a.id - b.id);

    const edges = scopedHops
      .filter((hop) => keyById.has(hop.virtualKeyId))
      .map((hop) => ({
        ...hop,
        // 席位主人打到自己的 Key 算「本人」，其余都是借用。
        owner: credentialById.get(hop.credentialId)?.ownerEmployeeId === keyById.get(hop.virtualKeyId)?.employeeId,
      }))
      .sort((a, b) => a.virtualKeyId - b.virtualKeyId || a.credentialId - b.credentialId);

    return {
      success: true,
      data: {
        windowMinutes,
        since: since.toISOString(),
        productLines: [...productLineOptions.values()].sort((a, b) => a.id - b.id),
        employees: [...employeesById.values()].sort((a, b) => a.id - b.id),
        virtualKeys: keyRows
          .map((row) => ({
            id: row.id,
            employeeId: row.employeeId,
            name: row.name,
            keyPrefix: row.keyPrefix,
            protocol: row.protocol,
            productLineId: row.productLineId,
            productLineName: row.productLineName,
            status: row.status,
          }))
          .sort((a, b) => a.id - b.id),
        credentials,
        hops: edges,
      },
    };
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

async function loadCredentialBindingViews(
  bindings: readonly {
    credentialId: number;
    scopeType: BindingScopeType;
    scopeId: number;
  }[],
): Promise<Map<number, CredentialBindingView>> {
  const views = new Map<number, CredentialBindingView>();
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

function coolingUntilIso(
  coolingKind: ReturnType<typeof resolveGraphCoolingKind>,
  coolUntil: Date | null,
  exhaustedUntil: Date | null,
): string | null {
  if (!coolingKind) return null;
  const until = coolingKind === "other" ? coolUntil : exhaustedUntil ?? coolUntil;
  return until ? until.toISOString() : null;
}
