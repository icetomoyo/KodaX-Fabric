import { and, gte, inArray } from "drizzle-orm";
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
  anchors?: CredentialWindowAnchors | null,
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
  // Anchored windows reset at their own boundary (anchor + 5h / learned phase);
  // unanchored Keys keep the legacy UTC-hour / epoch-aligned fallbacks.
  if (fiveHourExhausted) {
    resetCandidates.push(nextFiveHourResetAt(anchors?.fiveHourAnchor ?? null, now) ?? fiveHourResetAt(now));
  }
  if (weeklyExhausted) {
    resetCandidates.push(nextWeeklyResetAt(anchors?.weeklyResetAt ?? null, now));
  }
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

/**
 * Per-key upstream window state, persisted as first-class columns on
 * `upstream_credentials` (calibrated from 429 bodies; the 5h anchor is also
 * re-anchored on the first success after the previous window expired).
 *
 * The two windows have different semantics:
 * - 5h: first-use anchored tumbling window. No recovery inside the window;
 *   full reset at anchor + 5h; the next window anchors at the first request
 *   after expiry.
 * - weekly: fixed-phase tumbling window. Full reset at the learned instant,
 *   cycling every 7 days regardless of usage.
 */
export type CredentialWindowAnchors = {
  fiveHourAnchor: Date | null;
  weeklyResetAt: Date | null;
};

const FIVE_HOUR_MS = FIVE_HOUR_BUCKETS * HOUR_MS;
export { FIVE_HOUR_MS };

/**
 * Active anchored 5h window `[anchor, anchor + 5h)`, or null when the
 * anchor is missing (legacy Key, falls back to the rolling model) or the
 * window has expired (full headroom until the next request re-anchors).
 */
export function activeFiveHourWindow(
  anchor: Date | null,
  now: Date,
): { start: Date; end: Date } | null {
  if (!anchor) return null;
  const startMs = anchor.getTime();
  if (!Number.isFinite(startMs)) return null;
  if (now.getTime() - startMs >= FIVE_HOUR_MS) return null;
  return { start: new Date(startMs), end: new Date(startMs + FIVE_HOUR_MS) };
}

/** Next 5h full-reset instant while the anchored window is active; null when idle. */
export function nextFiveHourResetAt(anchor: Date | null, now: Date): Date | null {
  return activeFiveHourWindow(anchor, now)?.end ?? null;
}

/**
 * Start of the upstream weekly window containing `now`, from the learned
 * per-key phase (rolled forward by whole weeks). Falls back to the shared
 * epoch alignment for Keys that have never reported a 1310 reset instant.
 */
export function weeklyWindowStart(weeklyResetAt: Date | null, now: Date): Date {
  if (weeklyResetAt) {
    const base = weeklyResetAt.getTime();
    if (Number.isFinite(base)) {
      if (base > now.getTime()) return new Date(base - WEEK_MS);
      const cycles = Math.floor((now.getTime() - base) / WEEK_MS);
      return new Date(base + cycles * WEEK_MS);
    }
  }
  return weekStartOf(now);
}

/** Next weekly full-reset instant (learned phase rolled forward, epoch fallback). */
export function nextWeeklyResetAt(weeklyResetAt: Date | null, now: Date): Date {
  return new Date(weeklyWindowStart(weeklyResetAt, now).getTime() + WEEK_MS);
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

/** One hourly ledger bucket as fetched for quota aggregation. */
export type CredentialUsageBucketRow = {
  credentialId: number;
  hourStart: Date;
  totalTokens: number | string;
  totalCredits: number | string;
  requestCount: number | string;
};

/**
 * Sum ledger buckets per Key over each window's effective start:
 * - 5h: the anchored window `[anchor, anchor+5h)` when active; an expired
 *   anchor means full headroom (sum 0, the upstream window already flipped);
 *   a missing anchor falls back to the legacy rolling 5-bucket window.
 *   Buckets are UTC-hour aligned, so an anchor mid-hour excludes its first
 *   partial bucket (at most one hour of pre-anchor usage, and only when the
 *   Key served traffic in that hour — impossible right after expiry).
 * - weekly: the learned phase rolled to the cycle containing `now`
 *   (epoch fallback), so usage zeroes at the Key's real reset instant.
 */
export function aggregateCredentialUsage(
  rows: ReadonlyArray<CredentialUsageBucketRow>,
  credentialIds: readonly number[],
  anchorsById: ReadonlyMap<number, CredentialWindowAnchors> | null,
  now: Date,
): Map<number, CredentialQuotaUsage> {
  const usage = new Map<number, CredentialQuotaUsage>();
  const startsById = new Map<number, { fiveHour: Date | null; weekly: Date }>();
  for (const id of credentialIds) {
    const anchors = anchorsById?.get(id) ?? null;
    const fiveHourWindow = activeFiveHourWindow(anchors?.fiveHourAnchor ?? null, now);
    startsById.set(id, {
      fiveHour: fiveHourWindow
        ? fiveHourWindow.start
        : anchors?.fiveHourAnchor
          ? null
          : fiveHourWindowStart(now),
      weekly: weeklyWindowStart(anchors?.weeklyResetAt ?? null, now),
    });
    usage.set(id, {
      fiveHourTokens: 0,
      fiveHourCredits: 0,
      weeklyCredits: 0,
      fiveHourRequests: 0,
      weeklyRequests: 0,
    });
  }

  for (const row of rows) {
    const target = usage.get(row.credentialId);
    const starts = startsById.get(row.credentialId);
    if (!target || !starts) continue;
    const hourMs = row.hourStart.getTime();
    const credits = Number(row.totalCredits) || 0;
    if (starts.fiveHour != null && hourMs >= starts.fiveHour.getTime()) {
      target.fiveHourTokens = (target.fiveHourTokens ?? 0) + (Number(row.totalTokens) || 0);
      target.fiveHourCredits += credits;
      target.fiveHourRequests = (target.fiveHourRequests ?? 0) + (Number(row.requestCount) || 0);
    }
    if (hourMs >= starts.weekly.getTime()) {
      target.weeklyCredits += credits;
      target.weeklyRequests = (target.weeklyRequests ?? 0) + (Number(row.requestCount) || 0);
    }
  }
  return usage;
}

export async function getCredentialQuotaUsage(
  credentialIds: number[],
  now: Date = new Date(),
  anchorsById: ReadonlyMap<number, CredentialWindowAnchors> | null = null,
): Promise<Map<number, CredentialQuotaUsage>> {
  const empty = aggregateCredentialUsage([], credentialIds, anchorsById, now);
  if (credentialIds.length === 0) return empty;

  const legacyFiveHourStart = fiveHourWindowStart(now);
  const epochWeekStart = weekStartOf(now);
  let rangeStart = legacyFiveHourStart.getTime() <= epochWeekStart.getTime()
    ? legacyFiveHourStart
    : epochWeekStart;
  for (const id of credentialIds) {
    const anchors = anchorsById?.get(id);
    if (anchors?.fiveHourAnchor) {
      const window = activeFiveHourWindow(anchors.fiveHourAnchor, now);
      if (window && window.start.getTime() < rangeStart.getTime()) {
        rangeStart = window.start;
      }
    }
    if (anchors?.weeklyResetAt) {
      const start = weeklyWindowStart(anchors.weeklyResetAt, now);
      if (start.getTime() < rangeStart.getTime()) rangeStart = start;
    }
  }

  const rows = await db
    .select({
      credentialId: credentialUsageHourly.credentialId,
      hourStart: credentialUsageHourly.hourStart,
      totalTokens: credentialUsageHourly.totalTokens,
      totalCredits: credentialUsageHourly.totalCredits,
      requestCount: credentialUsageHourly.requestCount,
    })
    .from(credentialUsageHourly)
    .where(
      and(
        inArray(credentialUsageHourly.credentialId, credentialIds),
        gte(credentialUsageHourly.hourStart, rangeStart),
      ),
    );

  return aggregateCredentialUsage(rows, credentialIds, anchorsById, now);
}
