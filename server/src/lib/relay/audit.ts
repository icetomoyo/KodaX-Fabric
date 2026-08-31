import { sql } from "drizzle-orm";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import {
  credentialUsageHourly,
  employeeApiKeys,
  requestAudits,
  requestErrorLogs,
  usageCountersDaily,
  usageCountersTeamDaily,
} from "../../db/schema/index.js";
import { resolveLoggedError } from "../glm-error-codes.js";
import { quotaDayAt } from "../quota-time.js";
import { extractCacheReadTokens } from "../usage-cache.js";
import { hourStartOf } from "./credential-quota.js";
import { computeRequestCredits, getModelCreditRate } from "./credit-cost.js";
import { recordCredentialTokens } from "./credential-load.js";
import type {
  RelayCandidate,
  RelayPrincipal,
  RelayUsage,
} from "./types.js";

type RelayAuditStatus = "success" | "upstream_error" | "client_error" | "cancelled";

export type RelayAuditInput = {
  requestId: string;
  principal: RelayPrincipal;
  clientModel: string;
  candidate?: RelayCandidate | null;
  status: RelayAuditStatus;
  usage?: RelayUsage | null;
  startedAt?: Date;
  httpStatus?: number | null;
  upstreamStatus?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  upstreamPayload?: unknown;
};

function safeInteger(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(2_147_483_647, Math.trunc(value)));
}

export function emptyRelayUsage(): RelayUsage {
  return {
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    cacheReadTokens: null,
    raw: null,
  };
}

export type UsageIncrementTargets = {
  employeeDaily: true;
  teamDaily: boolean;
};

/** Dual-write plan: personal daily counters always; team daily when the Key is bound. */
export function usageIncrementTargets(teamId: number | null | undefined): UsageIncrementTargets {
  return {
    employeeDaily: true,
    teamDaily: teamId != null,
  };
}

export function parseRelayUsage(value: unknown): RelayUsage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyRelayUsage();
  const raw = value as Record<string, unknown>;
  const numberValue = (...keys: string[]): number | null => {
    for (const key of keys) {
      const candidate = raw[key];
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return Math.max(0, Math.trunc(candidate));
      }
    }
    return null;
  };
  const basePromptTokens = numberValue("prompt_tokens", "input_tokens");
  const cacheCreationTokens = numberValue("cache_creation_input_tokens");
  const anthropicCacheReadTokens = numberValue("cache_read_input_tokens");
  const hasAnthropicInputBreakdown =
    cacheCreationTokens !== null || anthropicCacheReadTokens !== null;
  const promptTokens = hasAnthropicInputBreakdown
    ? (basePromptTokens ?? 0) + (cacheCreationTokens ?? 0) + (anthropicCacheReadTokens ?? 0)
    : basePromptTokens;
  const completionTokens = numberValue("completion_tokens", "output_tokens");
  const suppliedTotal = numberValue("total_tokens");
  const totalTokens = suppliedTotal ??
    (promptTokens !== null && completionTokens !== null
      ? promptTokens + completionTokens
      : null);
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cacheReadTokens: extractCacheReadTokens(raw),
    raw,
  };
}

export async function writeRelayAudit(input: RelayAuditInput): Promise<void> {
  const usage = input.usage ?? emptyRelayUsage();
  const promptTokens = safeInteger(usage.promptTokens) ?? 0;
  const completionTokens = safeInteger(usage.completionTokens) ?? 0;
  const totalTokens = safeInteger(usage.totalTokens) ?? 0;
  const cacheReadTokens = safeInteger(usage.cacheReadTokens);
  const errorCount = input.status === "success" ? 0 : 1;
  const now = new Date();
  const startedAt = input.startedAt ?? now;
  const quotaDay = quotaDayAt(now, env.QUOTA_TIMEZONE);
  const credentialId = input.candidate?.credentialId;
  const shouldRecordHourly = input.status === "success" && totalTokens > 0 && credentialId != null;
  const creditRate = shouldRecordHourly ? await getModelCreditRate(input.clientModel) : null;
  const requestCredits = shouldRecordHourly
    ? computeRequestCredits(
      {
        promptTokens,
        completionTokens,
        cacheReadTokens: cacheReadTokens ?? 0,
      },
      creditRate,
      startedAt,
      now,
    )
    : 0;
  const requestCreditsText = requestCredits.toFixed(4);

  const recorded = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(requestAudits)
      .values({
        requestId: input.requestId,
        employeeId: input.principal.employeeId,
        employeeApiKeyId: input.principal.employeeApiKeyId,
        teamId: input.principal.teamId,
        clientModel: input.clientModel.slice(0, 128),
        providerCode: input.candidate?.providerCode,
        productLineId: input.candidate?.productLineId ?? input.principal.productLineId,
        productType: input.candidate?.productType,
        credentialId: input.candidate?.credentialId,
        status: input.status,
        promptTokens: safeInteger(usage.promptTokens),
        completionTokens: safeInteger(usage.completionTokens),
        totalTokens: safeInteger(usage.totalTokens),
        cacheReadTokens,
      })
      .onConflictDoNothing()
      .returning({ requestId: requestAudits.requestId });

    if (!inserted) return false;

    if (input.status !== "success") {
      const logged = resolveLoggedError({
        httpStatus: input.httpStatus,
        upstreamStatus: input.upstreamStatus,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        upstreamPayload: input.upstreamPayload,
      });
      await tx.insert(requestErrorLogs).values({
        requestId: input.requestId,
        employeeId: input.principal.employeeId,
        teamId: input.principal.teamId,
        clientModel: input.clientModel.slice(0, 128),
        providerCode: input.candidate?.providerCode,
        productLineId: input.candidate?.productLineId ?? input.principal.productLineId,
        productType: input.candidate?.productType,
        credentialId: input.candidate?.credentialId,
        status: input.status,
        httpStatus: safeInteger(logged.httpStatus),
        upstreamStatus: safeInteger(input.upstreamStatus),
        errorCode: logged.code,
        errorMessage: logged.message,
      });
    }

    await tx
      .insert(usageCountersDaily)
      .values({
        day: quotaDay,
        employeeId: input.principal.employeeId,
        promptTokens,
        completionTokens,
        totalTokens,
        requestCount: 1,
        errorCount,
      })
      .onConflictDoUpdate({
        target: [usageCountersDaily.day, usageCountersDaily.employeeId],
        set: {
          promptTokens: sql`${usageCountersDaily.promptTokens} + ${promptTokens}`,
          completionTokens: sql`${usageCountersDaily.completionTokens} + ${completionTokens}`,
          totalTokens: sql`${usageCountersDaily.totalTokens} + ${totalTokens}`,
          requestCount: sql`${usageCountersDaily.requestCount} + 1`,
          errorCount: sql`${usageCountersDaily.errorCount} + ${errorCount}`,
        },
      });

    const incrementTargets = usageIncrementTargets(input.principal.teamId);
    if (incrementTargets.teamDaily && input.principal.teamId != null) {
      await tx
        .insert(usageCountersTeamDaily)
        .values({
          day: quotaDay,
          teamId: input.principal.teamId,
          employeeId: input.principal.employeeId,
          promptTokens,
          completionTokens,
          totalTokens,
          requestCount: 1,
          errorCount,
        })
        .onConflictDoUpdate({
          target: [
            usageCountersTeamDaily.day,
            usageCountersTeamDaily.teamId,
            usageCountersTeamDaily.employeeId,
          ],
          set: {
            promptTokens: sql`${usageCountersTeamDaily.promptTokens} + ${promptTokens}`,
            completionTokens: sql`${usageCountersTeamDaily.completionTokens} + ${completionTokens}`,
            totalTokens: sql`${usageCountersTeamDaily.totalTokens} + ${totalTokens}`,
            requestCount: sql`${usageCountersTeamDaily.requestCount} + 1`,
            errorCount: sql`${usageCountersTeamDaily.errorCount} + ${errorCount}`,
          },
        });
    }

    if (shouldRecordHourly && credentialId != null) {
      await tx
        .insert(credentialUsageHourly)
        .values({
          credentialId,
          hourStart: hourStartOf(now),
          totalTokens,
          totalCredits: requestCreditsText,
          requestCount: 1,
        })
        .onConflictDoUpdate({
          target: [credentialUsageHourly.credentialId, credentialUsageHourly.hourStart],
          set: {
            totalTokens: sql`${credentialUsageHourly.totalTokens} + ${totalTokens}`,
            totalCredits: sql`${credentialUsageHourly.totalCredits} + ${requestCreditsText}::numeric`,
            requestCount: sql`${credentialUsageHourly.requestCount} + 1`,
          },
        });
    }

    await tx
      .update(employeeApiKeys)
      .set({ lastUsedAt: new Date() })
      .where(sql`${employeeApiKeys.id} = ${input.principal.employeeApiKeyId}`);
    return true;
  });
  if (recorded && credentialId != null && totalTokens > 0) {
    recordCredentialTokens(credentialId, totalTokens);
  }
}
