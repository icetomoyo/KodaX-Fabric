import { and, gte, inArray, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { credentialUsageHourly } from "../../db/schema/index.js";

const HOUR_MS = 3_600_000;
const FIVE_HOUR_BUCKETS = 5;
const WEEK_MS = 7 * 24 * HOUR_MS;

/**
 * GLM Coding Plan team weekly credits share one wall-clock phase
 * (not calendar Monday, not per-purchase). Upstream resets at
 * 18:49 Asia/Shanghai; we cut the window at 19:00 so the hour bucket
 * is closed and the upstream reset has landed.
 * 2026-09-03 19:00 Asia/Shanghai = 2026-09-03T11:00:00.000Z.
 * Subsequent windows are +7d from this instant.
 */
export const CREDENTIAL_WEEKLY_EPOCH = new Date("2026-09-03T11:00:00.000Z");

export type CredentialQuotaUsage = {
  fiveHourCredits: number;
  weeklyCredits: number;
};

export type CredentialQuotaLimits = {
  fiveHourLimit: number | null;
  weeklyLimit: number | null;
};

export type CredentialQuotaStatus = {
  fiveHourCredits: number;
  weeklyCredits: number;
  fiveHourLimit: number | null;
  weeklyLimit: number | null;
  fiveHourExhausted: boolean;
  weeklyExhausted: boolean;
  exhausted: boolean;
  exhaustedUntil: Date | null;
};

export type CreditCoolingKind = "five_hour" | "weekly" | "other";

/** Truncate `date` to the start of its UTC hour. Hourly buckets are stored in UTC. */
export function hourStartOf(date: Date): Date {
  return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS);
}

/**
 * Rolling 5-hour window start: the current UTC hour minus 4 hours
 * (covers the current hour bucket plus the previous four).
 */
export function fiveHourWindowStart(now: Date): Date {
  return new Date(hourStartOf(now).getTime() - (FIVE_HOUR_BUCKETS - 1) * HOUR_MS);
}

/**
 * Instant when the oldest bucket slides out of the 5-hour window
 * (`fiveHourWindowStart + 5h` = next UTC hour).
 */
export function fiveHourResetAt(now: Date): Date {
  return new Date(fiveHourWindowStart(now).getTime() + FIVE_HOUR_BUCKETS * HOUR_MS);
}

/**
 * Start of the 7-day credit window containing `now`, aligned to
 * `CREDENTIAL_WEEKLY_EPOCH` (shared across all GLM team-plan keys).
 */
export function weekStartOf(now: Date): Date {
  const elapsed = now.getTime() - CREDENTIAL_WEEKLY_EPOCH.getTime();
  const weeks = Math.floor(elapsed / WEEK_MS);
  return new Date(CREDENTIAL_WEEKLY_EPOCH.getTime() + weeks * WEEK_MS);
}

/**
 * Instant the current 7-day credit window ends (`weekStartOf + 7d`).
 */
export function weeklyResetAt(now: Date): Date {
  return new Date(weekStartOf(now).getTime() + WEEK_MS);
}

function windowReached(used: number, limit: number | null): boolean {
  return limit != null && used >= limit;
}

export function evaluateCredentialQuota(
  usage: CredentialQuotaUsage,
  limits: CredentialQuotaLimits,
  now: Date,
): CredentialQuotaStatus {
  const fiveHourExhausted = windowReached(usage.fiveHourCredits, limits.fiveHourLimit);
  const weeklyExhausted = windowReached(usage.weeklyCredits, limits.weeklyLimit);
  const resetCandidates: Date[] = [];
  if (fiveHourExhausted) resetCandidates.push(fiveHourResetAt(now));
  if (weeklyExhausted) resetCandidates.push(weeklyResetAt(now));
  const exhaustedUntil = resetCandidates.reduce<Date | null>((latest, candidate) => {
    if (!latest || candidate.getTime() > latest.getTime()) return candidate;
    return latest;
  }, null);

  return {
    fiveHourCredits: usage.fiveHourCredits,
    weeklyCredits: usage.weeklyCredits,
    fiveHourLimit: limits.fiveHourLimit,
    weeklyLimit: limits.weeklyLimit,
    fiveHourExhausted,
    weeklyExhausted,
    exhausted: fiveHourExhausted || weeklyExhausted,
    exhaustedUntil,
  };
}

export function creditCoolingKind(
  quota: Pick<CredentialQuotaStatus, "fiveHourExhausted" | "weeklyExhausted">,
): Exclude<CreditCoolingKind, "other"> | null {
  if (quota.weeklyExhausted) return "weekly";
  if (quota.fiveHourExhausted) return "five_hour";
  return null;
}

export function resolveGraphCoolingKind(
  status: "active" | "disabled" | "auto_disabled" | "cooling",
  quota: Pick<CredentialQuotaStatus, "fiveHourExhausted" | "weeklyExhausted">,
): CreditCoolingKind | null {
  return creditCoolingKind(quota) ?? (status === "cooling" ? "other" : null);
}

export function quotaExhaustedLastError(
  quota: Pick<CredentialQuotaStatus, "fiveHourExhausted" | "weeklyExhausted">,
): string {
  if (quota.weeklyExhausted) return "周积分额度耗尽，冷却至窗口重置";
  if (quota.fiveHourExhausted) return "5 小时积分额度耗尽，冷却至窗口重置";
  return "5 小时/周积分额度耗尽，冷却至窗口重置";
}

export async function getCredentialQuotaUsage(
  credentialIds: number[],
  now: Date = new Date(),
): Promise<Map<number, CredentialQuotaUsage>> {
  const usage = new Map<number, CredentialQuotaUsage>();
  for (const id of credentialIds) {
    usage.set(id, { fiveHourCredits: 0, weeklyCredits: 0 });
  }
  if (credentialIds.length === 0) return usage;

  const fiveHourStart = fiveHourWindowStart(now);
  const weekStart = weekStartOf(now);
  const rangeStart = fiveHourStart.getTime() <= weekStart.getTime() ? fiveHourStart : weekStart;
  const fiveHourStartIso = fiveHourStart.toISOString();
  const weekStartIso = weekStart.toISOString();

  const rows = await db
    .select({
      credentialId: credentialUsageHourly.credentialId,
      fiveHourCredits: sql<string>`
        coalesce(
          sum(${credentialUsageHourly.totalCredits})
          filter (where ${credentialUsageHourly.hourStart} >= ${fiveHourStartIso}::timestamptz),
          0
        )
      `,
      weeklyCredits: sql<string>`
        coalesce(
          sum(${credentialUsageHourly.totalCredits})
          filter (where ${credentialUsageHourly.hourStart} >= ${weekStartIso}::timestamptz),
          0
        )
      `,
    })
    .from(credentialUsageHourly)
    .where(
      and(
        inArray(credentialUsageHourly.credentialId, credentialIds),
        gte(credentialUsageHourly.hourStart, rangeStart),
      ),
    )
    .groupBy(credentialUsageHourly.credentialId);

  for (const row of rows) {
    usage.set(row.credentialId, {
      fiveHourCredits: Number(row.fiveHourCredits),
      weeklyCredits: Number(row.weeklyCredits),
    });
  }
  return usage;
}
