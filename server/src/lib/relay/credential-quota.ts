import { and, gte, inArray, sql } from "drizzle-orm";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import { credentialUsageHourly } from "../../db/schema/index.js";
import { addCalendarDays, parseDateOnly, quotaDayAt, zonedDayStart } from "../quota-time.js";

const HOUR_MS = 3_600_000;
const FIVE_HOUR_BUCKETS = 5;

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
  exhausted: boolean;
  exhaustedUntil: Date | null;
};

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
 * Monday 00:00 of the week containing `now`.
 *
 * Uses the same business timezone as daily/monthly quotas (`env.QUOTA_TIMEZONE`,
 * default Asia/Shanghai) via `quotaDayAt` / `zonedDayStart` — not UTC midnight.
 */
export function weekStartOf(now: Date): Date {
  return weekStartInZone(now, env.QUOTA_TIMEZONE);
}

/**
 * Next Monday 00:00 in `env.QUOTA_TIMEZONE` (same convention as `weekStartOf`).
 */
export function weeklyResetAt(now: Date): Date {
  const monday = quotaDayAt(weekStartOf(now), env.QUOTA_TIMEZONE);
  return zonedDayStart(addCalendarDays(monday, 7), env.QUOTA_TIMEZONE);
}

function weekStartInZone(now: Date, timeZone: string): Date {
  const today = quotaDayAt(now, timeZone);
  const calendarDay = parseDateOnly(today);
  if (!calendarDay) throw new Error(`Invalid quota day: ${today}`);
  const daysFromMonday = (calendarDay.getUTCDay() + 6) % 7;
  return zonedDayStart(addCalendarDays(today, -daysFromMonday), timeZone);
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
    exhausted: fiveHourExhausted || weeklyExhausted,
    exhaustedUntil,
  };
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
