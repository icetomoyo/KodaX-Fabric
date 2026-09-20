import { and, gte, inArray, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { credentialUsageHourly } from "../../db/schema/index.js";
import type { UpstreamUsageCapKind } from "../glm-error-codes.js";

const HOUR_MS = 3_600_000;
const FIVE_HOUR_BUCKETS = 5;
const WEEK_MS = 7 * 24 * HOUR_MS;

/**
 * Fallback 7-day window for proactive cooling when a 429 has no reset time
 * and the Key has no learned per-key phase.
 *
 * This is not an upstream invariant. Live 429s quote per-key times
 * (e.g. 2026-09-21 17:49:49 Asia/Shanghai); 2026-09-03 (Thu 19:00) and
 * 2026-09-21 (Mon 17:49) do not share a phase. Prefer the timestamp in
 * the 429 body. 2026-09-03 19:00 Asia/Shanghai = 2026-09-03T11:00:00.000Z.
 */
export const CREDENTIAL_WEEKLY_EPOCH = new Date("2026-09-03T11:00:00.000Z");

export type CredentialQuotaUsage = {
  fiveHourTokens?: number;
  fiveHourCredits: number;
  weeklyCredits: number;
  fiveHourRequests?: number;
  weeklyRequests?: number;
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

/** Cool a Key before Zhipu 429: 5h is short and concurrent, weekly cooling lasts days. */
export const FIVE_HOUR_COOL_RATIO = 0.85;
export const WEEKLY_COOL_RATIO = 0.95;

function windowReached(used: number, limit: number | null, ratio: number): boolean {
  return limit != null && used >= limit * ratio;
}

export function evaluateCredentialQuota(
  usage: CredentialQuotaUsage,
  limits: CredentialQuotaLimits,
  now: Date,
): CredentialQuotaStatus {
  const fiveHourExhausted = windowReached(
    usage.fiveHourCredits,
    limits.fiveHourLimit,
    FIVE_HOUR_COOL_RATIO,
  );
  const weeklyExhausted = windowReached(
    usage.weeklyCredits,
    limits.weeklyLimit,
    WEEKLY_COOL_RATIO,
  );
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
  if (quota.weeklyExhausted) return "周积分达到 95%，冷却至窗口重置";
  if (quota.fiveHourExhausted) return "5 小时积分达到 85%，冷却至窗口重置";
  return "5 小时/周积分达到冷却阈值，冷却至窗口重置";
}

/**
 * Add in-flight requests to the observed usage. Upstream bills the whole
 * request once it lands, so requests still streaming count against both
 * windows at the credential's observed per-request average.
 */
export function withInFlightEstimate(
  usage: CredentialQuotaUsage,
  inFlightRequests: number,
): CredentialQuotaUsage {
  const inFlight = Number.isFinite(inFlightRequests) ? Math.trunc(inFlightRequests) : 0;
  if (inFlight <= 0) return usage;
  const fiveHourRequests = usage.fiveHourRequests ?? 0;
  const weeklyRequests = usage.weeklyRequests ?? 0;
  const perRequestCredits = fiveHourRequests > 0
    ? usage.fiveHourCredits / fiveHourRequests
    : weeklyRequests > 0
      ? usage.weeklyCredits / weeklyRequests
      : 0;
  if (perRequestCredits <= 0) return usage;
  const estimate = inFlight * perRequestCredits;
  return {
    ...usage,
    fiveHourCredits: usage.fiveHourCredits + estimate,
    weeklyCredits: usage.weeklyCredits + estimate,
  };
}

/**
 * Fraction of credit headroom left, taking the tighter of the configured
 * windows. Keys without limits return 1 (no quota pressure at all).
 */
export function remainingQuotaFraction(
  usage: Pick<CredentialQuotaUsage, "fiveHourCredits" | "weeklyCredits">,
  limits: CredentialQuotaLimits,
): number {
  const fractions: number[] = [];
  if (limits.fiveHourLimit != null && limits.fiveHourLimit > 0) {
    fractions.push(1 - usage.fiveHourCredits / limits.fiveHourLimit);
  }
  if (limits.weeklyLimit != null && limits.weeklyLimit > 0) {
    fractions.push(1 - usage.weeklyCredits / limits.weeklyLimit);
  }
  if (fractions.length === 0) return 1;
  return Math.max(0, Math.min(1, Math.min(...fractions)));
}

/** Per-key cap reset instants learned from upstream replies, stored in `upstream_credentials.meta`. */
export type LearnedCapResets = {
  fiveHour?: string;
  weekly?: string;
  monthly?: string;
};

const LEARNED_WINDOW_MS: Record<Exclude<UpstreamUsageCapKind, "other">, number> = {
  five_hour: FIVE_HOUR_BUCKETS * HOUR_MS,
  weekly: WEEK_MS,
  monthly: 30 * 24 * HOUR_MS,
};

function learnedKeyFor(kind: UpstreamUsageCapKind): keyof LearnedCapResets | null {
  if (kind === "five_hour") return "fiveHour";
  if (kind === "weekly") return "weekly";
  if (kind === "monthly") return "monthly";
  return null;
}

function asMetaObject(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === "object" && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : {};
}

export function learnedCapResetFromMeta(meta: unknown): LearnedCapResets | null {
  const raw = asMetaObject(meta).learnedCapReset;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const pick = (key: keyof LearnedCapResets) =>
    typeof record[key] === "string" ? (record[key] as string) : undefined;
  const learned: LearnedCapResets = {
    fiveHour: pick("fiveHour"),
    weekly: pick("weekly"),
    monthly: pick("monthly"),
  };
  if (!learned.fiveHour && !learned.weekly && !learned.monthly) return null;
  return learned;
}

/**
 * Next reset instant after `now`, cycling the learned per-key phase forward
 * by the window length. Returns the learned instant itself when still ahead.
 */
export function learnedNextReset(
  learned: LearnedCapResets | null,
  kind: UpstreamUsageCapKind,
  now: Date,
): Date | null {
  const key = kind === "other" ? null : learnedKeyFor(kind);
  if (!learned || !key) return null;
  const iso = learned[key];
  if (!iso) return null;
  const base = Date.parse(iso);
  if (!Number.isFinite(base)) return null;
  if (base >= now.getTime()) return new Date(base);
  const windowMs = LEARNED_WINDOW_MS[kind as Exclude<UpstreamUsageCapKind, "other">];
  const cycles = Math.ceil((now.getTime() - base) / windowMs);
  return new Date(base + cycles * windowMs);
}

/** Merge the just-observed reset instant into `meta.learnedCapReset`. */
export function mergeLearnedCapReset(
  meta: unknown,
  kind: UpstreamUsageCapKind,
  resetAt: Date,
): Record<string, unknown> {
  const object = asMetaObject(meta);
  const key = learnedKeyFor(kind);
  if (!key) return object;
  const existing = learnedCapResetFromMeta(meta) ?? {};
  return {
    ...object,
    learnedCapReset: { ...existing, [key]: resetAt.toISOString() },
  };
}

/**
 * Evidence that a Key was drained outside this relay: the upstream says the
 * window is exhausted while our ledger is far below the limit, so the gap
 * is a lower bound on off-platform usage. Persisted under `meta.externalDrain`.
 */
export type ExternalDrainObservation = {
  kind: Exclude<UpstreamUsageCapKind, "other">;
  localCredits: number;
  limit: number;
  externalEstimate: number;
  observedAt: string;
};

/** Record external drain only when the ledger is well below the limit (small drift is normal). */
export const EXTERNAL_DRAIN_RATIO = 0.85;

export function externalDrainObservation(input: {
  kind: UpstreamUsageCapKind;
  localCredits: number;
  limit: number | null;
  now: Date;
}): ExternalDrainObservation | null {
  if (input.kind === "other" || input.limit == null || input.limit <= 0) return null;
  if (input.localCredits >= input.limit * EXTERNAL_DRAIN_RATIO) return null;
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    kind: input.kind,
    localCredits: round(input.localCredits),
    limit: input.limit,
    externalEstimate: round(input.limit - input.localCredits),
    observedAt: input.now.toISOString(),
  };
}

export async function getCredentialQuotaUsage(
  credentialIds: number[],
  now: Date = new Date(),
): Promise<Map<number, CredentialQuotaUsage>> {
  const usage = new Map<number, CredentialQuotaUsage>();
  for (const id of credentialIds) {
    usage.set(id, {
      fiveHourTokens: 0,
      fiveHourCredits: 0,
      weeklyCredits: 0,
      fiveHourRequests: 0,
      weeklyRequests: 0,
    });
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
      fiveHourTokens: sql<string>`
        coalesce(
          sum(${credentialUsageHourly.totalTokens})
          filter (where ${credentialUsageHourly.hourStart} >= ${fiveHourStartIso}::timestamptz),
          0
        )
      `,
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
      fiveHourRequests: sql<string>`
        coalesce(
          sum(${credentialUsageHourly.requestCount})
          filter (where ${credentialUsageHourly.hourStart} >= ${fiveHourStartIso}::timestamptz),
          0
        )
      `,
      weeklyRequests: sql<string>`
        coalesce(
          sum(${credentialUsageHourly.requestCount})
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
      fiveHourTokens: Number(row.fiveHourTokens),
      fiveHourCredits: Number(row.fiveHourCredits),
      weeklyCredits: Number(row.weeklyCredits),
      fiveHourRequests: Number(row.fiveHourRequests),
      weeklyRequests: Number(row.weeklyRequests),
    });
  }
  return usage;
}
