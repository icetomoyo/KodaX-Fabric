import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import {
  credentialBindingMembers,
  credentialBindings,
  departments,
  employeeApiKeys,
  employees,
  productLines,
  providers,
  teamMembers,
  teams,
  upstreamCredentials,
  usageCountersDaily,
} from "../../db/schema/index.js";
import { addCalendarDays, quotaDayAt } from "../quota-time.js";
import {
  averageDailyTokensFromWindow,
  classifyUsageTier,
  effectiveUsageTier,
  usageTierForRequest,
} from "../usage-tier.js";
import {
  effectiveCredentialStatus,
  type CredentialStatus,
} from "../credential-status.js";

import type { UsageTier } from "../usage-tier.js";
import {
  evaluateCredentialQuota,
  getCredentialQuotaUsage,
  remainingQuotaFraction,
  withInFlightEstimate,
  type CredentialQuotaStatus,
  type CredentialWindowAnchors,
} from "./credential-quota.js";
import { getCredentialLoad } from "./credential-load.js";
import { isRelayProtocol, type RelayProtocol } from "./protocol.js";
import { isOpenPoolProvider, OPEN_POOL_PROVIDER_CODE } from "./open-pool.js";
import {
  loadRelayPool,
  resolveRelayUpstreamConfig,
  type RelayPool,
} from "./channel-pool.js";
import { firstLevelDepartmentId } from "../department-tree.js";

export type BindingScopeType = "employee" | "team" | "enterprise" | "department";

export type BindingScope = {
  scopeType: BindingScopeType;
  scopeId: number;
};

export type ResolveBindingScopeInput = {
  employeeId: number;
  usageTier: UsageTier;
  teamId: number | null;
  departmentId: number | null;
  enterpriseId: number | null;
};

export type BoundCredential = {
  credentialId: number;
  credentialSuffix: string;
  secretEncrypted: string;
  credentialPriority: number;
  credentialWeight: number;
  credentialStatus: CredentialStatus;
  coolUntil: Date | null;
  productLineId: number;
  productType: "api" | "coding_plan";
  retryPolicy: unknown;
  providerCode: string;
  authStyle: string;
  supportedProtocols: RelayProtocol[];
  baseUrl: string;
  fiveHourCreditLimit: number | null;
  weeklyCreditLimit: number | null;
  fiveHourWindowAnchor: Date | null;
  weeklyWindowResetAt: Date | null;
  meta: unknown;
};

export type AcquireBindingParams = {
  employeeId: number;
  productLineId: number;
  protocol: RelayProtocol;
  teamId?: number | null;
  now?: Date;
  excludeCredentialIds?: ReadonlySet<number>;
  /**
   * Live requests omit this (default true): idle accounts are promoted to
   * 标准 so the first call can bind an enterprise-shared Key.
   * The daily rebind job sets false so idle accounts stay unbound.
   */
  promoteIdle?: boolean;
};

type PooledAcquireParams = AcquireBindingParams & { pool: RelayPool };

export type AcquireBindingResult =
  | { ok: true; credential: BoundCredential; bindingScope: BindingScope; replaced: boolean }
  | { ok: false; reason: "no_scope" | "exhausted_pool" | "no_binding_available"; retryAt: Date | null };

const MAX_POOL_ATTEMPTS = 3;

type EmployeeScopeRow = {
  usageTier: UsageTier;
  enterpriseId: number | null;
  createdAt: Date;
};

export type BindingEligibilityPerson = {
  id: number;
  usageTier: UsageTier;
  teamId: number | null;
  departmentId: number | null;
  enterpriseId: number | null;
};

type TeamMembershipRow = {
  teamId: number;
  departmentId: number;
};

type BindingLocatorRow = {
  bindingId: number;
  credentialId: number;
};

type CredentialSnapshotRow = {
  credentialId: number;
  credentialSuffix: string;
  secretEncrypted: string;
  credentialPriority: number;
  credentialWeight: number;
  credentialStatus: CredentialStatus;
  coolUntil: Date | null;
  productLineId: number;
  relayPoolKey: string;
  productType: "api" | "coding_plan";
  retryPolicy: unknown;
  providerCode: string;
  legacyAuthStyle: string;
  supportedProtocols: RelayProtocol[];
  defaultBaseUrl: string;
  baseUrlOverride: string | null;
  protocolConfigs: unknown;
  fiveHourCreditLimit: string | null;
  weeklyCreditLimit: string | null;
  fiveHourWindowAnchor: Date | null;
  weeklyWindowResetAt: Date | null;
  meta: unknown;
};

type LoadedBinding = {
  bindingId: number;
  snapshot: CredentialSnapshotRow;
  scopeType: BindingScopeType;
  scopeId: number;
};

type EnterpriseShard = {
  bindingId: number;
  credentialId: number;
  memberCount: number;
};

type MemberJoinResult = "added" | "already" | "full";

const credentialSnapshotSelect = {
  credentialId: upstreamCredentials.id,
  credentialSuffix: upstreamCredentials.secretSuffix,
  secretEncrypted: upstreamCredentials.secretEncrypted,
  credentialPriority: upstreamCredentials.priority,
  credentialWeight: upstreamCredentials.weight,
  credentialStatus: upstreamCredentials.status,
  coolUntil: upstreamCredentials.coolUntil,
  productLineId: productLines.id,
  relayPoolKey: productLines.relayPoolKey,
  productType: productLines.productType,
  retryPolicy: productLines.retryPolicy,
  providerCode: providers.code,
  legacyAuthStyle: providers.authStyle,
  supportedProtocols: upstreamCredentials.supportedProtocols,
  defaultBaseUrl: providers.defaultBaseUrl,
  baseUrlOverride: productLines.baseUrlOverride,
  protocolConfigs: productLines.protocolConfigs,
  fiveHourCreditLimit: upstreamCredentials.fiveHourCreditLimit,
  weeklyCreditLimit: upstreamCredentials.weeklyCreditLimit,
  fiveHourWindowAnchor: upstreamCredentials.fiveHourWindowAnchor,
  weeklyWindowResetAt: upstreamCredentials.weeklyWindowResetAt,
  meta: upstreamCredentials.meta,
};

/**
 * Map a usage-tier employee onto the binding scope that should own a Key.
 *
 * idle → none; heavy → exclusive employee Key; standard → enterprise share
 * (max STANDARD_SHARE_CAPACITY employees per Key).
 * Returns null when the required subject is missing (idle, or standard
 * without an enterprise). Request-time acquire may promote idle → 标准 first.
 */
export const STANDARD_SHARE_CAPACITY = 5;

export function resolveBindingScope(input: ResolveBindingScopeInput): BindingScope | null {
  if (input.usageTier === "idle") return null;
  if (input.usageTier === "heavy") {
    return { scopeType: "employee", scopeId: input.employeeId };
  }
  if (input.usageTier === "standard" && input.enterpriseId != null) {
    return { scopeType: "enterprise", scopeId: input.enterpriseId };
  }
  return null;
}

/** Fill existing enterprise shards to 5 people before allocating a new Key. */
export function pickStandardShareSlot(
  shards: readonly { id: number; memberCount: number }[],
): number | null {
  const open = shards.filter((row) => row.memberCount < STANDARD_SHARE_CAPACITY);
  if (open.length === 0) return null;
  return [...open].sort((a, b) => b.memberCount - a.memberCount || a.id - b.id)[0]?.id ?? null;
}

/**
 * Resolve scope from the 7-day daily average (no stored-tier lookup).
 */
export function resolveBindingScopeFromPeak(
  input: Omit<ResolveBindingScopeInput, "usageTier"> & {
    peakTokens?: number | null;
    averageDailyTokens?: number | null;
  },
): BindingScope | null {
  return resolveBindingScope({
    employeeId: input.employeeId,
    usageTier: classifyUsageTier(input.averageDailyTokens ?? input.peakTokens),
    teamId: input.teamId,
    departmentId: input.departmentId,
    enterpriseId: input.enterpriseId,
  });
}

export type BindingNeedRow = BindingScope & {
  id?: number;
  memberEmployeeIds?: readonly number[];
};

function personResolvesOnto(person: BindingEligibilityPerson, binding: BindingScope): boolean {
  const scope = resolveBindingScope({
    employeeId: person.id,
    usageTier: person.usageTier,
    teamId: person.teamId,
    departmentId: person.departmentId,
    enterpriseId: person.enterpriseId,
  });
  return scope?.scopeType === binding.scopeType && scope.scopeId === binding.scopeId;
}

/** True when at least one active employee would currently resolve onto this scope. */
export function bindingStillNeeded(
  binding: BindingNeedRow,
  people: readonly BindingEligibilityPerson[],
): boolean {
  if (binding.scopeType === "enterprise") {
    const memberIds = new Set(binding.memberEmployeeIds ?? []);
    if (memberIds.size === 0) return false;
    return people.some((person) => memberIds.has(person.id) && personResolvesOnto(person, binding));
  }
  return people.some((person) => personResolvesOnto(person, binding));
}

export function unusedBindingIds(
  bindings: readonly BindingNeedRow[],
  people: readonly BindingEligibilityPerson[],
): number[] {
  return bindings
    .filter((row) => row.id != null && !bindingStillNeeded(row, people))
    .map((row) => row.id as number);
}

/** Bound Keys with no calls in this window go back to the pool. */
export const IDLE_BINDING_WINDOW_MS = 2 * 60 * 60 * 1_000;

export type IdleBindingCandidate = {
  id: number;
  boundAt: Date;
  lastUsedAt: Date | null;
};

export function idleBindingIds(
  bindings: readonly IdleBindingCandidate[],
  now: Date,
): number[] {
  const cutoff = now.getTime() - IDLE_BINDING_WINDOW_MS;
  return bindings
    .filter((row) => {
      if (row.boundAt.getTime() > cutoff) return false;
      if (row.lastUsedAt != null && row.lastUsedAt.getTime() > cutoff) return false;
      return true;
    })
    .map((row) => row.id);
}

/** Drop bindings whose Key has had no calls for 2 hours. */
export async function releaseIdleCredentialBindings(now: Date = new Date()): Promise<number> {
  const rows = await db
    .select({
      id: credentialBindings.id,
      credentialId: credentialBindings.credentialId,
      boundAt: credentialBindings.boundAt,
      lastUsedAt: upstreamCredentials.lastUsedAt,
    })
    .from(credentialBindings)
    .innerJoin(upstreamCredentials, eq(upstreamCredentials.id, credentialBindings.credentialId));
  if (rows.length === 0) return 0;

  const ids = idleBindingIds(
    rows.map((row) => ({
      id: row.id,
      boundAt: row.boundAt,
      lastUsedAt: row.lastUsedAt,
    })),
    now,
  );
  if (ids.length === 0) return 0;
  const deleted = await db
    .delete(credentialBindings)
    .where(inArray(credentialBindings.id, ids))
    .returning({ id: credentialBindings.id });
  return deleted.length;
}

/**
 * Enterprise that currently owns a binding. Enterprise-scoped rows are the
 * scope itself; other scopes use the subject's `enterpriseId`.
 */
export function enterpriseIdForBindingScope(
  binding: BindingScope,
  subjectEnterpriseId: number | null | undefined,
): number | null {
  if (binding.scopeType === "enterprise") return binding.scopeId;
  return subjectEnterpriseId ?? null;
}

export type ReleasedCredentialBinding = {
  id: number;
  credentialId: number;
  productLineId: number;
  scopeType: BindingScopeType;
  scopeId: number;
};

/** Drop the current binding so the channel Key returns to the unbound pool. */
export async function releaseCredentialBinding(
  credentialId: number,
): Promise<ReleasedCredentialBinding | null> {
  const [row] = await db
    .delete(credentialBindings)
    .where(eq(credentialBindings.credentialId, credentialId))
    .returning({
      id: credentialBindings.id,
      credentialId: credentialBindings.credentialId,
      productLineId: credentialBindings.productLineId,
      scopeType: credentialBindings.scopeType,
      scopeId: credentialBindings.scopeId,
    });
  return row ?? null;
}

export async function loadBindingEnterpriseId(
  binding: BindingScope,
): Promise<number | null> {
  if (binding.scopeType === "enterprise") return binding.scopeId;
  if (binding.scopeType === "employee") {
    const [row] = await db
      .select({ enterpriseId: employees.enterpriseId })
      .from(employees)
      .where(eq(employees.id, binding.scopeId))
      .limit(1);
    return row?.enterpriseId ?? null;
  }
  if (binding.scopeType === "department") {
    const [row] = await db
      .select({ enterpriseId: departments.enterpriseId })
      .from(departments)
      .where(eq(departments.id, binding.scopeId))
      .limit(1);
    return row?.enterpriseId ?? null;
  }
  const [row] = await db
    .select({ enterpriseId: teams.enterpriseId })
    .from(teams)
    .where(eq(teams.id, binding.scopeId))
    .limit(1);
  return row?.enterpriseId ?? null;
}

async function loadRecentUsage(
  employeeId: number,
  now: Date,
): Promise<{ averageDailyTokens: number | null; requestCount: number }> {
  const today = quotaDayAt(now, env.QUOTA_TIMEZONE);
  const usageFrom = addCalendarDays(today, -6);
  const [row] = await db
    .select({
      totalTokens: sql<number>`coalesce(sum(${usageCountersDaily.totalTokens}), 0)`,
      requestCount: sql<number>`coalesce(sum(${usageCountersDaily.requestCount}), 0)`,
    })
    .from(usageCountersDaily)
    .where(
      and(
        eq(usageCountersDaily.employeeId, employeeId),
        gte(usageCountersDaily.day, usageFrom),
        lte(usageCountersDaily.day, today),
      ),
    );
  const total = Number(row?.totalTokens);
  const requests = Number(row?.requestCount);
  return {
    averageDailyTokens: Number.isFinite(total) && total > 0 ? averageDailyTokensFromWindow(total) : null,
    requestCount: Number.isFinite(requests) && requests > 0 ? requests : 0,
  };
}

type ResolvedEmployeeBinding = {
  liveTier: UsageTier;
  storedTier: UsageTier;
  teamId: number | null;
  departmentId: number | null;
  enterpriseId: number | null;
};

/**
 * Load the employee's live usage tier / org membership and resolve the binding
 * scope. Missing employees return null.
 */
export async function resolveEmployeeBindingScope(
  employeeId: number,
  now: Date = new Date(),
): Promise<BindingScope | null> {
  const resolved = await resolveEmployeeBinding(employeeId, now);
  if (!resolved) return null;
  return resolveBindingScope({
    employeeId,
    usageTier: resolved.liveTier,
    teamId: resolved.teamId,
    departmentId: resolved.departmentId,
    enterpriseId: resolved.enterpriseId,
  });
}

async function resolveEmployeeBinding(
  employeeId: number,
  now: Date,
  teamId?: number | null,
): Promise<ResolvedEmployeeBinding | null> {
  const [employee, membership, usage] = await Promise.all([
    db
      .select({
        usageTier: employees.usageTier,
        enterpriseId: employees.enterpriseId,
        createdAt: employees.createdAt,
      })
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1)
      .then((rows): EmployeeScopeRow | undefined => rows[0]),
    db
      .select({ teamId: teamMembers.teamId, departmentId: teams.departmentId })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(
        and(
          eq(teamMembers.employeeId, employeeId),
          teamId != null ? eq(teams.id, teamId) : sql`true`,
        ),
      )
      .limit(1)
      .then((rows): TeamMembershipRow | undefined => rows[0]),
    loadRecentUsage(employeeId, now),
  ]);
  if (!employee) return null;
  const liveTier = effectiveUsageTier(
    usage.averageDailyTokens,
    employee.createdAt,
    now,
    usage.requestCount,
    employeeId,
  );
  const leafDepartmentId = membership?.departmentId ?? null;
  return {
    liveTier,
    storedTier: employee.usageTier,
    teamId: membership?.teamId ?? null,
    departmentId: leafDepartmentId == null
      ? null
      : await firstLevelDepartmentIdFromDb(leafDepartmentId),
    enterpriseId: employee.enterpriseId,
  };
}

async function firstLevelDepartmentIdFromDb(departmentId: number): Promise<number> {
  const rows = await db
    .select({ id: departments.id, parentId: departments.parentId })
    .from(departments);
  return firstLevelDepartmentId(departmentId, rows);
}

async function isOpenPoolProductLine(productLineId: number): Promise<boolean> {
  const [row] = await db
    .select({ providerCode: providers.code })
    .from(productLines)
    .innerJoin(providers, eq(productLines.providerId, providers.id))
    .where(eq(productLines.id, productLineId))
    .limit(1);
  return isOpenPoolProvider(row?.providerCode);
}

/** Per-Key upstream window state carried on credential snapshots. */
function snapshotAnchors(
  snapshot: Pick<CredentialSnapshotRow, "fiveHourWindowAnchor" | "weeklyWindowResetAt">,
): CredentialWindowAnchors {
  return {
    fiveHourAnchor: snapshot.fiveHourWindowAnchor,
    weeklyResetAt: snapshot.weeklyWindowResetAt,
  };
}

function anchorsMapFromSnapshots(
  snapshots: readonly CredentialSnapshotRow[],
): Map<number, CredentialWindowAnchors> {
  return new Map(
    snapshots.map((snapshot) => [snapshot.credentialId, snapshotAnchors(snapshot)]),
  );
}

async function acquireOpenPoolCredential(
  params: AcquireBindingParams,
  now: Date,
): Promise<AcquireBindingResult> {
  await restoreExpiredCooling([params.productLineId], now);
  const pool = await loadChannelPool(
    [params.productLineId],
    params.protocol,
    params.excludeCredentialIds ?? new Set(),
    false,
  );
  const usageMap = await getCredentialQuotaUsage(
    pool.map((row) => row.credentialId),
    now,
    anchorsMapFromSnapshots(pool),
  );
  const usable: Array<{
    snapshot: CredentialSnapshotRow;
    credential: BoundCredential;
    headroom: number;
  }> = [];
  const retryTimes: number[] = [];
  for (const snapshot of pool) {
    const limits = {
      fiveHourLimit: creditLimitNumber(snapshot.fiveHourCreditLimit),
      weeklyLimit: creditLimitNumber(snapshot.weeklyCreditLimit),
    };
    const usage = withInFlightEstimate(
      usageMap.get(snapshot.credentialId) ?? { fiveHourCredits: 0, weeklyCredits: 0 },
      getCredentialLoad(snapshot.credentialId).inFlight,
    );
    const quota = evaluateCredentialQuota(usage, limits, now, snapshotAnchors(snapshot));
    const status = effectiveCredentialStatus(snapshot.credentialStatus, snapshot.coolUntil, now);
    if (quota.exhausted && quota.exhaustedUntil) {
      retryTimes.push(quota.exhaustedUntil.getTime());
    }
    if (status === "cooling" && snapshot.coolUntil) {
      retryTimes.push(snapshot.coolUntil.getTime());
    }
    if (status !== "active" || quota.exhausted) continue;
    const credential = toBoundCredential(snapshot, params.protocol, now);
    if (!credential) continue;
    usable.push({ snapshot, credential, headroom: remainingQuotaFraction(usage, limits) });
  }
  usable.sort(
    (a, b) =>
      b.snapshot.credentialPriority - a.snapshot.credentialPriority ||
      b.headroom - a.headroom ||
      b.snapshot.credentialWeight - a.snapshot.credentialWeight ||
      a.snapshot.credentialId - b.snapshot.credentialId,
  );
  const picked = usable[0];
  if (picked) {
    return {
      ok: true,
      credential: picked.credential,
      bindingScope: { scopeType: "employee", scopeId: params.employeeId },
      replaced: false,
    };
  }
  if (retryTimes.length) {
    return { ok: false, reason: "exhausted_pool", retryAt: earliestFuture(retryTimes, now) };
  }
  return { ok: false, reason: "no_binding_available", retryAt: null };
}

/**
 * Return a usable Key for the employee's scope on this product line's
 * relay pool (Zhipu coding-plan packages share one pool).
 *
 * Reuses the current binding when the Key is active, in-protocol, not excluded,
 * and under quota. Keys at 85% of the 5-hour or 95% of the weekly credit limit
 * are skipped as a scheduling preference only (no cooling write — upstream 429
 * signals own the cooling state) and the binding is released.
 * Cooling / disabled / excluded Keys only release the row. Replacement picks
 * the highest priority unbound Key; insert uses ON CONFLICT DO NOTHING and
 * a reread so a concurrent winner for the same scope is adopted when usable.
 */
export async function acquireBoundCredential(
  params: AcquireBindingParams,
): Promise<AcquireBindingResult> {
  const now = params.now ?? new Date();
  if (await isOpenPoolProductLine(params.productLineId)) {
    return acquireOpenPoolCredential(params, now);
  }
  const pool = await loadRelayPool(params.productLineId);
  if (!pool) {
    return { ok: false, reason: "no_binding_available", retryAt: null };
  }
  const pooled: PooledAcquireParams = { ...params, pool };
  const resolved = await resolveEmployeeBinding(params.employeeId, now, params.teamId);
  if (!resolved) {
    return { ok: false, reason: "no_scope", retryAt: null };
  }
  const liveTier =
    params.promoteIdle === false ? resolved.liveTier : usageTierForRequest(resolved.liveTier);
  const scope = resolveBindingScope({
    employeeId: params.employeeId,
    usageTier: liveTier,
    teamId: resolved.teamId,
    departmentId: resolved.departmentId,
    enterpriseId: resolved.enterpriseId,
  });
  if (!scope) {
    return { ok: false, reason: "no_scope", retryAt: null };
  }
  const tierChanged = liveTier !== resolved.storedTier;
  if (tierChanged) {
    await db
      .update(employees)
      .set({ usageTier: liveTier, updatedAt: now })
      .where(eq(employees.id, params.employeeId));
  }

  await restoreExpiredCooling(pool.productLineIds, now);

  let result: AcquireBindingResult;
  if (scope.scopeType === "enterprise") {
    result = await acquireEnterpriseShare(pooled, scope, now);
  } else {
    await clearEnterpriseMembership(params.employeeId, pool.key);
    const existing = await loadScopeBinding(pool.key, scope);
    if (existing) {
      const verdict = await inspectSnapshot(
        existing.snapshot,
        params.protocol,
        now,
        params.excludeCredentialIds,
      );
      if (verdict.kind === "usable") {
        result = {
          ok: true,
          credential: verdict.credential,
          bindingScope: scope,
          replaced: false,
        };
      } else {
        // 配额判定只做调度避让，不写冷却状态（上游 429 才写）。
        await deleteBinding(existing.bindingId);
        result = await bindFromPool(pooled, scope, now, true);
      }
    } else {
      result = await bindFromPool(pooled, scope, now, false);
    }
  }

  if (result.ok && tierChanged) {
    await releaseOrphanBindings(now);
  }
  return result;
}

async function acquireEnterpriseShare(
  params: PooledAcquireParams,
  scope: BindingScope,
  now: Date,
): Promise<AcquireBindingResult> {
  const existingMember = await loadMemberBinding(params.employeeId, params.pool.key);
  if (existingMember) {
    const verdict = await inspectSnapshot(
      existingMember.snapshot,
      params.protocol,
      now,
      params.excludeCredentialIds,
    );
    if (verdict.kind === "usable") {
      return {
        ok: true,
        credential: verdict.credential,
        bindingScope: scope,
        replaced: false,
      };
    }
    // 配额判定只做调度避让，不写冷却状态（上游 429 才写）。
    await deleteBinding(existingMember.bindingId);
  }

  const exclude = new Set(params.excludeCredentialIds ?? []);
  for (let attempt = 0; attempt < MAX_POOL_ATTEMPTS + 2; attempt += 1) {
    const shards = await listEnterpriseShards(params.pool.key, scope.scopeId);
    const packedId = pickStandardShareSlot(
      shards.map((row) => ({ id: row.bindingId, memberCount: row.memberCount })),
    );
    if (packedId != null) {
      const shard = shards.find((row) => row.bindingId === packedId);
      if (!shard) continue;
      const snapshot = await loadCredentialSnapshot(shard.credentialId);
      if (!snapshot) {
        await deleteBinding(shard.bindingId);
        continue;
      }
      const verdict = await inspectSnapshot(snapshot, params.protocol, now, exclude);
      if (verdict.kind === "usable") {
        const joined = await tryAddMember(
          shard.bindingId,
          params.employeeId,
          snapshot.productLineId,
          params.pool.key,
        );
        if (joined === "added") {
          return {
            ok: true,
            credential: verdict.credential,
            bindingScope: scope,
            replaced: false,
          };
        }
        if (joined === "already") {
          const mine = await loadMemberBinding(params.employeeId, params.pool.key);
          if (mine) {
            const mineVerdict = await inspectSnapshot(mine.snapshot, params.protocol, now, exclude);
            if (mineVerdict.kind === "usable") {
              return {
                ok: true,
                credential: mineVerdict.credential,
                bindingScope: scope,
                replaced: false,
              };
            }
          }
        }
        continue;
      }
      // 配额判定只做调度避让，不写冷却状态（上游 429 才写）。
      await deleteBinding(shard.bindingId);
      exclude.add(shard.credentialId);
      continue;
    }

    const outcome = await tryBindFromPool(params, scope, now, exclude, false);
    if (outcome.kind === "done") {
      if (!outcome.result.ok) return outcome.result;
      const created = await loadBindingByCredentialId(outcome.result.credential.credentialId);
      if (!created) return { ok: false, reason: "no_binding_available", retryAt: null };
      const joined = await tryAddMember(
        created.bindingId,
        params.employeeId,
        outcome.result.credential.productLineId,
        params.pool.key,
      );
      if (joined === "added") return outcome.result;
      if (joined === "already") {
        const mine = await loadMemberBinding(params.employeeId, params.pool.key);
        if (mine) {
          const mineVerdict = await inspectSnapshot(mine.snapshot, params.protocol, now, exclude);
          if (mineVerdict.kind === "usable") {
            return {
              ok: true,
              credential: mineVerdict.credential,
              bindingScope: scope,
              replaced: false,
            };
          }
        }
      }
      exclude.add(outcome.result.credential.credentialId);
      continue;
    }
    for (const id of outcome.excludeMore) exclude.add(id);
  }
  return { ok: false, reason: "no_binding_available", retryAt: null };
}

/**
 * Bind each employee to the Key their current usage tier requires, once
 * per relay pool. Used when the daily job moves people across tiers.
 */
export async function rebindEmployeesToCurrentScope(
  employeeIds: readonly number[],
  now: Date = new Date(),
): Promise<number> {
  if (employeeIds.length === 0) return 0;
  const keys = await db
    .select({
      employeeId: employeeApiKeys.employeeId,
      productLineId: employeeApiKeys.productLineId,
      protocol: employeeApiKeys.protocol,
      teamId: employeeApiKeys.teamId,
      providerCode: providers.code,
      relayPoolKey: productLines.relayPoolKey,
    })
    .from(employeeApiKeys)
    .innerJoin(productLines, eq(employeeApiKeys.productLineId, productLines.id))
    .innerJoin(providers, eq(productLines.providerId, providers.id))
    .where(
      and(
        inArray(employeeApiKeys.employeeId, [...employeeIds]),
        eq(employeeApiKeys.status, "active"),
      ),
    );
  const seen = new Set<string>();
  let bound = 0;
  for (const key of keys) {
    const stamp = `${key.employeeId}:${key.relayPoolKey || key.productLineId}`;
    if (seen.has(stamp)) continue;
    seen.add(stamp);
    if (isOpenPoolProvider(key.providerCode)) continue;
    if (!isRelayProtocol(key.protocol)) continue;
    const result = await acquireBoundCredential({
      employeeId: key.employeeId,
      productLineId: key.productLineId,
      protocol: key.protocol,
      teamId: key.teamId,
      now,
      promoteIdle: false,
    });
    if (result.ok) bound += 1;
  }
  return bound;
}

/**
 * Drop bindings that nobody would currently resolve onto: missing/disabled
 * subjects, or scopes left empty after a usage-tier upgrade/downgrade.
 */
export async function releaseOrphanBindings(now: Date = new Date()): Promise<number> {
  const [rows, people, openLineRows, memberRows] = await Promise.all([
    db
      .select({
        id: credentialBindings.id,
        scopeType: credentialBindings.scopeType,
        scopeId: credentialBindings.scopeId,
        productLineId: credentialBindings.productLineId,
      })
      .from(credentialBindings),
    loadEmployeesForEligibility(now),
    db
      .select({ id: productLines.id })
      .from(productLines)
      .innerJoin(providers, eq(productLines.providerId, providers.id))
      .where(eq(providers.code, OPEN_POOL_PROVIDER_CODE)),
    db
      .select({
        bindingId: credentialBindingMembers.bindingId,
        employeeId: credentialBindingMembers.employeeId,
      })
      .from(credentialBindingMembers),
  ]);
  const membersByBinding = new Map<number, number[]>();
  for (const row of memberRows) {
    const list = membersByBinding.get(row.bindingId) ?? [];
    list.push(row.employeeId);
    membersByBinding.set(row.bindingId, list);
  }
  const openLineIds = new Set(openLineRows.map((row) => row.id));
  const ids = [
    ...rows.filter((row) => openLineIds.has(row.productLineId)).map((row) => row.id),
    ...unusedBindingIds(
      rows
        .filter((row) => !openLineIds.has(row.productLineId))
        .map((row) => ({
          id: row.id,
          scopeType: row.scopeType,
          scopeId: row.scopeId,
          memberEmployeeIds: membersByBinding.get(row.id) ?? [],
        })),
      people,
    ),
  ];
  if (ids.length === 0) return 0;
  const deleted = await db
    .delete(credentialBindings)
    .where(inArray(credentialBindings.id, ids))
    .returning({ id: credentialBindings.id });
  return deleted.length;
}

async function loadEmployeesForEligibility(_now: Date): Promise<BindingEligibilityPerson[]> {
  const [people, memberships, departmentRows] = await Promise.all([
    db
      .select({
        id: employees.id,
        usageTier: employees.usageTier,
        enterpriseId: employees.enterpriseId,
      })
      .from(employees)
      .where(eq(employees.status, "active")),
    db
      .select({
        employeeId: teamMembers.employeeId,
        teamId: teamMembers.teamId,
        departmentId: teams.departmentId,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id)),
    db
      .select({ id: departments.id, parentId: departments.parentId })
      .from(departments),
  ]);
  const membershipsByEmployee = new Map<number, { teamId: number; departmentId: number }[]>();
  for (const row of memberships) {
    const list = membershipsByEmployee.get(row.employeeId) ?? [];
    list.push({ teamId: row.teamId, departmentId: row.departmentId });
    membershipsByEmployee.set(row.employeeId, list);
  }
  return people.flatMap((row) => {
    const personMemberships = membershipsByEmployee.get(row.id) ?? [];
    if (personMemberships.length === 0) {
      return [{
        id: row.id,
        usageTier: row.usageTier,
        enterpriseId: row.enterpriseId,
        teamId: null,
        departmentId: null,
      }];
    }
    const seen = new Set<number>();
    const views: BindingEligibilityPerson[] = [];
    for (const membership of personMemberships) {
      const departmentId = firstLevelDepartmentId(membership.departmentId, departmentRows);
      if (seen.has(departmentId)) continue;
      seen.add(departmentId);
      views.push({
        id: row.id,
        usageTier: row.usageTier,
        enterpriseId: row.enterpriseId,
        teamId: membership.teamId,
        departmentId,
      });
    }
    return views;
  });
}

type SnapshotVerdict =
  | { kind: "usable"; credential: BoundCredential }
  | { kind: "exhausted"; status: CredentialQuotaStatus }
  | { kind: "unusable" };

async function inspectSnapshot(
  snapshot: CredentialSnapshotRow,
  protocol: RelayProtocol,
  now: Date,
  excludeCredentialIds: ReadonlySet<number> | undefined,
): Promise<SnapshotVerdict> {
  const usageMap = await getCredentialQuotaUsage(
    [snapshot.credentialId],
    now,
    anchorsMapFromSnapshots([snapshot]),
  );
  const usage = withInFlightEstimate(
    usageMap.get(snapshot.credentialId) ?? { fiveHourCredits: 0, weeklyCredits: 0 },
    getCredentialLoad(snapshot.credentialId).inFlight,
  );
  const quota = evaluateCredentialQuota(
    usage,
    {
      fiveHourLimit: creditLimitNumber(snapshot.fiveHourCreditLimit),
      weeklyLimit: creditLimitNumber(snapshot.weeklyCreditLimit),
    },
    now,
    snapshotAnchors(snapshot),
  );
  if (quota.exhausted) {
    return { kind: "exhausted", status: quota };
  }
  if (excludeCredentialIds?.has(snapshot.credentialId)) {
    return { kind: "unusable" };
  }
  const status = effectiveCredentialStatus(snapshot.credentialStatus, snapshot.coolUntil, now);
  if (status !== "active" || snapshot.credentialWeight <= 0) {
    return { kind: "unusable" };
  }
  if (!supportsProtocol(snapshot.supportedProtocols, protocol)) {
    return { kind: "unusable" };
  }
  const credential = toBoundCredential(snapshot, protocol, now);
  if (!credential) return { kind: "unusable" };
  return { kind: "usable", credential };
}

async function bindFromPool(
  params: PooledAcquireParams,
  scope: BindingScope,
  now: Date,
  replaced: boolean,
): Promise<AcquireBindingResult> {
  const exclude = new Set(params.excludeCredentialIds ?? []);
  for (let attempt = 0; attempt < MAX_POOL_ATTEMPTS; attempt += 1) {
    const outcome = await tryBindFromPool(params, scope, now, exclude, replaced);
    if (outcome.kind === "done") return outcome.result;
    for (const id of outcome.excludeMore) exclude.add(id);
  }
  return { ok: false, reason: "no_binding_available", retryAt: null };
}

type PoolAttempt =
  | { kind: "done"; result: AcquireBindingResult }
  | { kind: "retry"; excludeMore: number[] };

async function tryBindFromPool(
  params: PooledAcquireParams,
  scope: BindingScope,
  now: Date,
  exclude: ReadonlySet<number>,
  replaced: boolean,
): Promise<PoolAttempt> {
  const pool = await loadUnboundPool(params.pool, params.protocol, exclude);
  const usageMap = await getCredentialQuotaUsage(
    pool.map((row) => row.credentialId),
    now,
    anchorsMapFromSnapshots(pool),
  );

  const usable: Array<{
    snapshot: CredentialSnapshotRow;
    credential: BoundCredential;
    headroom: number;
  }> = [];
  const retryTimes: number[] = [];
  for (const snapshot of pool) {
    const limits = {
      fiveHourLimit: creditLimitNumber(snapshot.fiveHourCreditLimit),
      weeklyLimit: creditLimitNumber(snapshot.weeklyCreditLimit),
    };
    const usage = withInFlightEstimate(
      usageMap.get(snapshot.credentialId) ?? { fiveHourCredits: 0, weeklyCredits: 0 },
      getCredentialLoad(snapshot.credentialId).inFlight,
    );
    const quota = evaluateCredentialQuota(usage, limits, now, snapshotAnchors(snapshot));
    const status = effectiveCredentialStatus(snapshot.credentialStatus, snapshot.coolUntil, now);
    if (quota.exhausted) {
      if (quota.exhaustedUntil) retryTimes.push(quota.exhaustedUntil.getTime());
    }
    if (status === "cooling" && snapshot.coolUntil) {
      retryTimes.push(snapshot.coolUntil.getTime());
    }
    if (status !== "active" || quota.exhausted) continue;
    const credential = toBoundCredential(snapshot, params.protocol, now);
    if (!credential) continue;
    usable.push({ snapshot, credential, headroom: remainingQuotaFraction(usage, limits) });
  }

  // Same-priority Keys prefer the one with the most remaining quota headroom,
  // spreading bursts across the pool instead of draining one Key to its cap.
  usable.sort(
    (a, b) =>
      b.snapshot.credentialPriority - a.snapshot.credentialPriority ||
      b.headroom - a.headroom ||
      b.snapshot.credentialWeight - a.snapshot.credentialWeight ||
      a.snapshot.credentialId - b.snapshot.credentialId,
  );

  if (usable.length === 0) {
    return {
      kind: "done",
      result: {
        ok: false,
        reason: "exhausted_pool",
        retryAt: earliestFuture(retryTimes, now),
      },
    };
  }

  const picked = usable[0];
  await db
    .insert(credentialBindings)
    .values({
      credentialId: picked.snapshot.credentialId,
      productLineId: picked.snapshot.productLineId,
      relayPoolKey: params.pool.key,
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
    })
    .onConflictDoNothing();

  const reread =
    scope.scopeType === "enterprise"
      ? await loadBindingByCredentialId(picked.snapshot.credentialId)
      : await loadScopeBinding(params.pool.key, scope);
  if (!reread) {
    return { kind: "retry", excludeMore: [picked.snapshot.credentialId] };
  }
  if (reread.scopeType !== scope.scopeType || reread.scopeId !== scope.scopeId) {
    return { kind: "retry", excludeMore: [picked.snapshot.credentialId] };
  }

  const verdict = await inspectSnapshot(reread.snapshot, params.protocol, now, exclude);
  if (verdict.kind === "usable") {
    return {
      kind: "done",
      result: {
        ok: true,
        credential: verdict.credential,
        bindingScope: scope,
        replaced,
      },
    };
  }
  // 配额判定只做调度避让（本轮不选它、解绑换 Key），不写入 cooling 状态：
  // 本地账本是推导值，冷却状态只由上游 429 信号写入。
  await deleteBinding(reread.bindingId);
  return { kind: "retry", excludeMore: [reread.snapshot.credentialId, picked.snapshot.credentialId] };
}

async function restoreExpiredCooling(productLineIds: readonly number[], now: Date): Promise<void> {
  if (productLineIds.length === 0) return;
  await db
    .update(upstreamCredentials)
    .set({ status: "active", coolUntil: null, updatedAt: now })
    .where(
      and(
        eq(upstreamCredentials.status, "cooling"),
        or(isNull(upstreamCredentials.coolUntil), lte(upstreamCredentials.coolUntil, now)),
        inArray(upstreamCredentials.productLineId, [...productLineIds]),
      ),
    );
}

async function loadScopeBinding(
  relayPoolKey: string,
  scope: BindingScope,
): Promise<LoadedBinding | null> {
  const [locator] = await db
    .select({
      bindingId: credentialBindings.id,
      credentialId: credentialBindings.credentialId,
      scopeType: credentialBindings.scopeType,
      scopeId: credentialBindings.scopeId,
    })
    .from(credentialBindings)
    .where(
      and(
        eq(credentialBindings.relayPoolKey, relayPoolKey),
        eq(credentialBindings.scopeType, scope.scopeType),
        eq(credentialBindings.scopeId, scope.scopeId),
      ),
    )
    .limit(1);
  if (!locator) return null;

  const snapshot = await loadCredentialSnapshot(locator.credentialId);
  if (!snapshot) {
    await deleteBinding(locator.bindingId);
    return null;
  }
  return {
    bindingId: locator.bindingId,
    snapshot,
    scopeType: locator.scopeType,
    scopeId: locator.scopeId,
  };
}

async function loadBindingByCredentialId(credentialId: number): Promise<LoadedBinding | null> {
  const [locator] = await db
    .select({
      bindingId: credentialBindings.id,
      credentialId: credentialBindings.credentialId,
      scopeType: credentialBindings.scopeType,
      scopeId: credentialBindings.scopeId,
    })
    .from(credentialBindings)
    .where(eq(credentialBindings.credentialId, credentialId))
    .limit(1);
  if (!locator) return null;
  const snapshot = await loadCredentialSnapshot(locator.credentialId);
  if (!snapshot) {
    await deleteBinding(locator.bindingId);
    return null;
  }
  return {
    bindingId: locator.bindingId,
    snapshot,
    scopeType: locator.scopeType,
    scopeId: locator.scopeId,
  };
}

async function loadMemberBinding(
  employeeId: number,
  relayPoolKey: string,
): Promise<LoadedBinding | null> {
  const [row] = await db
    .select({
      bindingId: credentialBindings.id,
      credentialId: credentialBindings.credentialId,
      scopeType: credentialBindings.scopeType,
      scopeId: credentialBindings.scopeId,
    })
    .from(credentialBindingMembers)
    .innerJoin(credentialBindings, eq(credentialBindings.id, credentialBindingMembers.bindingId))
    .where(
      and(
        eq(credentialBindingMembers.employeeId, employeeId),
        eq(credentialBindingMembers.relayPoolKey, relayPoolKey),
      ),
    )
    .limit(1);
  if (!row) return null;
  const snapshot = await loadCredentialSnapshot(row.credentialId);
  if (!snapshot) {
    await deleteBinding(row.bindingId);
    return null;
  }
  return {
    bindingId: row.bindingId,
    snapshot,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
  };
}

async function listEnterpriseShards(
  relayPoolKey: string,
  enterpriseId: number,
): Promise<EnterpriseShard[]> {
  const rows = await db
    .select({
      bindingId: credentialBindings.id,
      credentialId: credentialBindings.credentialId,
      memberCount: sql<number>`coalesce(count(${credentialBindingMembers.id}), 0)`,
    })
    .from(credentialBindings)
    .leftJoin(
      credentialBindingMembers,
      eq(credentialBindingMembers.bindingId, credentialBindings.id),
    )
    .where(
      and(
        eq(credentialBindings.relayPoolKey, relayPoolKey),
        eq(credentialBindings.scopeType, "enterprise"),
        eq(credentialBindings.scopeId, enterpriseId),
      ),
    )
    .groupBy(credentialBindings.id, credentialBindings.credentialId);
  return rows.map((row) => ({
    bindingId: row.bindingId,
    credentialId: row.credentialId,
    memberCount: Number(row.memberCount) || 0,
  }));
}

async function tryAddMember(
  bindingId: number,
  employeeId: number,
  productLineId: number,
  relayPoolKey: string,
): Promise<MemberJoinResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from credential_bindings where id = ${bindingId} for update`);
    const [existing] = await tx
      .select({ bindingId: credentialBindingMembers.bindingId })
      .from(credentialBindingMembers)
      .where(
        and(
          eq(credentialBindingMembers.employeeId, employeeId),
          eq(credentialBindingMembers.relayPoolKey, relayPoolKey),
        ),
      )
      .limit(1);
    if (existing) return "already";
    const [tally] = await tx
      .select({ n: count() })
      .from(credentialBindingMembers)
      .where(eq(credentialBindingMembers.bindingId, bindingId));
    if (Number(tally?.n) >= STANDARD_SHARE_CAPACITY) return "full";
    await tx.insert(credentialBindingMembers).values({
      bindingId,
      employeeId,
      productLineId,
      relayPoolKey,
    });
    return "added";
  });
}

async function clearEnterpriseMembership(employeeId: number, relayPoolKey: string): Promise<void> {
  await db
    .delete(credentialBindingMembers)
    .where(
      and(
        eq(credentialBindingMembers.employeeId, employeeId),
        eq(credentialBindingMembers.relayPoolKey, relayPoolKey),
      ),
    );
}

async function loadCredentialSnapshot(credentialId: number): Promise<CredentialSnapshotRow | null> {
  const [row] = await db
    .select(credentialSnapshotSelect)
    .from(upstreamCredentials)
    .innerJoin(productLines, eq(upstreamCredentials.productLineId, productLines.id))
    .innerJoin(providers, eq(productLines.providerId, providers.id))
    .where(eq(upstreamCredentials.id, credentialId))
    .limit(1);
  return row ?? null;
}

async function loadUnboundPool(
  pool: RelayPool,
  protocol: RelayProtocol,
  exclude: ReadonlySet<number>,
): Promise<CredentialSnapshotRow[]> {
  return loadChannelPool(pool.activeProductLineIds, protocol, exclude, true);
}

async function loadChannelPool(
  productLineIds: readonly number[],
  protocol: RelayProtocol,
  exclude: ReadonlySet<number>,
  unboundOnly: boolean,
): Promise<CredentialSnapshotRow[]> {
  if (productLineIds.length === 0) return [];
  const excludeIds = [...exclude];
  const rows = await db
    .select(credentialSnapshotSelect)
    .from(upstreamCredentials)
    .innerJoin(productLines, eq(upstreamCredentials.productLineId, productLines.id))
    .innerJoin(providers, eq(productLines.providerId, providers.id))
    .leftJoin(credentialBindings, eq(credentialBindings.credentialId, upstreamCredentials.id))
    .where(
      and(
        inArray(upstreamCredentials.productLineId, [...productLineIds]),
        gt(upstreamCredentials.weight, 0),
        unboundOnly ? isNull(credentialBindings.id) : undefined,
        or(
          eq(upstreamCredentials.status, "active"),
          eq(upstreamCredentials.status, "cooling"),
        ),
        excludeIds.length > 0 ? notInArray(upstreamCredentials.id, excludeIds) : undefined,
      ),
    )
    .orderBy(
      desc(upstreamCredentials.priority),
      desc(upstreamCredentials.weight),
      asc(upstreamCredentials.id),
    );
  const unique = unboundOnly
    ? rows
    : rows.filter((row, index, all) => all.findIndex((item) => item.credentialId === row.credentialId) === index);
  return unique.filter((row) => supportsProtocol(row.supportedProtocols, protocol));
}

async function deleteBinding(bindingId: number): Promise<void> {
  await db.delete(credentialBindings).where(eq(credentialBindings.id, bindingId));
}

function toBoundCredential(
  snapshot: CredentialSnapshotRow,
  protocol: RelayProtocol,
  now: Date,
): BoundCredential | null {
  const upstreamConfig = resolveRelayUpstreamConfig({
    protocol,
    providerCode: snapshot.providerCode,
    productType: snapshot.productType,
    protocolConfigs: snapshot.protocolConfigs,
    legacyBaseUrl: snapshot.baseUrlOverride || snapshot.defaultBaseUrl,
    legacyAuthStyle: snapshot.legacyAuthStyle,
  });
  if (!upstreamConfig) return null;
  return {
    credentialId: snapshot.credentialId,
    credentialSuffix: snapshot.credentialSuffix,
    secretEncrypted: snapshot.secretEncrypted,
    credentialPriority: snapshot.credentialPriority,
    credentialWeight: snapshot.credentialWeight,
    credentialStatus: effectiveCredentialStatus(
      snapshot.credentialStatus,
      snapshot.coolUntil,
      now,
    ),
    coolUntil: snapshot.coolUntil,
    productLineId: snapshot.productLineId,
    productType: snapshot.productType,
    retryPolicy: snapshot.retryPolicy,
    providerCode: snapshot.providerCode,
    authStyle: upstreamConfig.authStyle,
    supportedProtocols: snapshot.supportedProtocols,
    baseUrl: upstreamConfig.baseUrl,
    fiveHourCreditLimit: creditLimitNumber(snapshot.fiveHourCreditLimit),
    weeklyCreditLimit: creditLimitNumber(snapshot.weeklyCreditLimit),
    fiveHourWindowAnchor: snapshot.fiveHourWindowAnchor,
    weeklyWindowResetAt: snapshot.weeklyWindowResetAt,
    meta: snapshot.meta,
  };
}

function creditLimitNumber(value: string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function supportsProtocol(
  protocols: readonly RelayProtocol[] | null | undefined,
  protocol: RelayProtocol,
): boolean {
  return protocols?.includes(protocol) ?? false;
}

function earliestFuture(times: number[], now: Date): Date | null {
  const future = times.filter((value) => Number.isFinite(value) && value > now.getTime());
  if (future.length === 0) return null;
  return new Date(Math.min(...future));
}
