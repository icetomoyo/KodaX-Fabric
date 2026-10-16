import type { FastifyInstance } from "fastify";
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  channelSeats,
  employeeApiKeys,
  employees,
  enterprises,
  productLines,
  providers,
  requestAudits,
  upstreamCredentials,
} from "../../db/schema/index.js";
import { effectiveCredentialStatus } from "../../lib/credential-status.js";
import { snapshotRelayLiveLoad } from "../../lib/relay/credential-load.js";
import { writeOpsAudit } from "../../lib/ops-audit.js";
import { loadCredentialMembers, releaseCredentialBinding } from "../../lib/relay/binding.js";
import { effectiveKeyMaxMembers } from "../../lib/relay/key-limits.js";
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

    const [credentialRows, hopRows] = await Promise.all([
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
          holderEmployeeId: channelSeats.employeeId,
          holderName: employees.name,
          keyMaxMembers: productLines.keyMaxMembers,
        })
        .from(upstreamCredentials)
        .innerJoin(productLines, eq(upstreamCredentials.productLineId, productLines.id))
        .innerJoin(providers, eq(productLines.providerId, providers.id))
        .leftJoin(channelSeats, eq(channelSeats.credentialId, upstreamCredentials.id))
        .leftJoin(employees, eq(employees.id, channelSeats.employeeId)),
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

    const membershipById = await loadCredentialMembers(visibleCredentials.map((row) => row.id));
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
          // 调度不按本地估算提前让出：只有用满才算额度冷却。
          { fiveHour: 1, weekly: 1 },
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
          bound: membershipById.get(row.id)?.bound ?? false,
          members: (membershipById.get(row.id)?.members ?? []).map((member) => ({
            employeeId: member.employeeId,
            name: member.name,
            lastUsedAt: member.lastUsedAt?.toISOString() ?? null,
          })),
          memberLimit: effectiveKeyMaxMembers(row.keyMaxMembers),
          holderEmployeeId: row.holderEmployeeId,
          holderName: row.holderName,
        };
      })
      .sort((a, b) => a.id - b.id);

    const edges = scopedHops
      .filter((hop) => keyById.has(hop.virtualKeyId))
      .map((hop) => ({
        ...hop,
        // 持有人打到自己持有的 Key，其余都是借用。
        holder: credentialById.get(hop.credentialId)?.holderEmployeeId === keyById.get(hop.virtualKeyId)?.employeeId,
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
    const membership = (await loadCredentialMembers([credentialId])).get(credentialId);
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
        members: (membership?.members ?? []).map((member) => member.name),
      },
      ip: req.ip,
    });

    return {
      success: true,
      data: {
        credentialId: released.credentialId,
        productLineId: released.productLineId,
        releasedMembers: membership?.members.length ?? 0,
      },
    };
  });
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
