import {
  and,
  asc,
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
  credentialBindings,
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
import { resolveProtocolUpstreamConfig } from "../upstream-protocol-config.js";
import type { UsageTier } from "../usage-tier.js";
import {
  evaluateCredentialQuota,
  getCredentialQuotaUsage,
  quotaExhaustedLastError,
  type CredentialQuotaStatus,
} from "./credential-quota.js";
import { isRelayProtocol, type RelayProtocol } from "./protocol.js";
import { isOpenPoolProvider, OPEN_POOL_PROVIDER_CODE } from "./open-pool.js";

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
};

export type AcquireBindingParams = {
  employeeId: number;
  productLineId: number;
  protocol: RelayProtocol;
  now?: Date;
  excludeCredentialIds?: ReadonlySet<number>;
  /**
   * Live requests omit this (default true): idle accounts are promoted to
   * 标准 so the first call can bind a department-shared Key.
   * The daily rebind job sets false so idle accounts stay unbound.
   */
  promoteIdle?: boolean;
};

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
};

type LoadedBinding = {
  bindingId: number;
  snapshot: CredentialSnapshotRow;
};

const credentialSnapshotSelect = {
  credentialId: upstreamCredentials.id,
  credentialSuffix: upstreamCredentials.secretSuffix,
  secretEncrypted: upstreamCredentials.secretEncrypted,
  credentialPriority: upstreamCredentials.priority,
  credentialWeight: upstreamCredentials.weight,
  credentialStatus: upstreamCredentials.status,
  coolUntil: upstreamCredentials.coolUntil,
  productLineId: productLines.id,
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
};

/**
 * Map a usage-tier employee onto the binding scope that should own a Key.
 *
 * idle → none; heavy → exclusive employee Key; standard → department share.
 * Returns null when the required subject is missing (idle, or standard
 * without a department). Request-time acquire may promote idle → 标准 first.
 */
export function resolveBindingScope(input: ResolveBindingScopeInput): BindingScope | null {
  if (input.usageTier === "idle") return null;
  if (input.usageTier === "heavy") {
    return { scopeType: "employee", scopeId: input.employeeId };
  }
  if (input.usageTier === "standard" && input.departmentId != null) {
    return { scopeType: "department", scopeId: input.departmentId };
  }
  return null;
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

/** True when at least one active employee would currently resolve onto this scope. */
export function bindingStillNeeded(
  binding: BindingScope,
  people: readonly BindingEligibilityPerson[],
): boolean {
  return people.some((person) => {
    const scope = resolveBindingScope({
      employeeId: person.id,
      usageTier: person.usageTier,
      teamId: person.teamId,
      departmentId: person.departmentId,
      enterpriseId: person.enterpriseId,
    });
    return scope?.scopeType === binding.scopeType && scope.scopeId === binding.scopeId;
  });
}

export function unusedBindingIds(
  bindings: readonly { id: number; scopeType: BindingScopeType; scopeId: number }[],
  people: readonly BindingEligibilityPerson[],
): number[] {
  return bindings
    .filter((row) => !bindingStillNeeded(row, people))
    .map((row) => row.id);
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
      .where(eq(teamMembers.employeeId, employeeId))
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
  );
  return {
    liveTier,
    storedTier: employee.usageTier,
    teamId: membership?.teamId ?? null,
    departmentId: membership?.departmentId ?? null,
    enterpriseId: employee.enterpriseId,
  };
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

async function acquireOpenPoolCredential(
  params: AcquireBindingParams,
  now: Date,
): Promise<AcquireBindingResult> {
  await restoreExpiredCooling(params.productLineId, now);
  const pool = await loadChannelPool(
    params.productLineId,
    params.protocol,
    params.excludeCredentialIds ?? new Set(),
    false,
  );
  const usageMap = await getCredentialQuotaUsage(
    pool.map((row) => row.credentialId),
    now,
  );
  const retryTimes: number[] = [];
  for (const snapshot of pool) {
    const usage = usageMap.get(snapshot.credentialId) ?? { fiveHourCredits: 0, weeklyCredits: 0 };
    const quota = evaluateCredentialQuota(
      usage,
      {
        fiveHourLimit: creditLimitNumber(snapshot.fiveHourCreditLimit),
        weeklyLimit: creditLimitNumber(snapshot.weeklyCreditLimit),
      },
      now,
    );
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
    return {
      ok: true,
      credential,
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
 * Return a usable Key for the employee's scope on this product line.
 *
 * Reuses the current binding when the Key is active, in-protocol, not excluded,
 * and under quota. Keys at 85% of the 5-hour or 95% of the weekly credit
 * limit are cooled until that window resets (this may lengthen an existing
 * coolUntil) and the binding is released.
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
  const resolved = await resolveEmployeeBinding(params.employeeId, now);
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

  await restoreExpiredCooling(params.productLineId, now);

  let result: AcquireBindingResult;
  const existing = await loadScopeBinding(params.productLineId, scope);
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
      if (verdict.kind === "exhausted") {
        await coolCredentialForQuota(existing.snapshot.credentialId, verdict.status, now);
      }
      await deleteBinding(existing.bindingId);
      result = await bindFromPool(params, scope, now, true);
    }
  } else {
    result = await bindFromPool(params, scope, now, false);
  }

  if (result.ok && tierChanged) {
    await releaseOrphanBindings(now);
  }
  return result;
}

/**
 * Bind each employee to the Key their current usage tier requires, one
 * product line at a time. Used when the daily job moves people across tiers.
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
      providerCode: providers.code,
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
    const stamp = `${key.employeeId}:${key.productLineId}`;
    if (seen.has(stamp)) continue;
    seen.add(stamp);
    if (isOpenPoolProvider(key.providerCode)) continue;
    if (!isRelayProtocol(key.protocol)) continue;
    const result = await acquireBoundCredential({
      employeeId: key.employeeId,
      productLineId: key.productLineId,
      protocol: key.protocol,
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
  const [rows, people, openLineRows] = await Promise.all([
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
  ]);
  const openLineIds = new Set(openLineRows.map((row) => row.id));
  const ids = [
    ...rows.filter((row) => openLineIds.has(row.productLineId)).map((row) => row.id),
    ...unusedBindingIds(
      rows.filter((row) => !openLineIds.has(row.productLineId)),
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
  const [people, memberships] = await Promise.all([
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
  ]);
  const membershipByEmployee = new Map(
    memberships.map((row) => [row.employeeId, { teamId: row.teamId, departmentId: row.departmentId }]),
  );
  return people.map((row) => {
    const membership = membershipByEmployee.get(row.id);
    return {
      id: row.id,
      usageTier: row.usageTier,
      enterpriseId: row.enterpriseId,
      teamId: membership?.teamId ?? null,
      departmentId: membership?.departmentId ?? null,
    };
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
  const usageMap = await getCredentialQuotaUsage([snapshot.credentialId], now);
  const usage = usageMap.get(snapshot.credentialId) ?? { fiveHourCredits: 0, weeklyCredits: 0 };
  const quota = evaluateCredentialQuota(
    usage,
    {
      fiveHourLimit: creditLimitNumber(snapshot.fiveHourCreditLimit),
      weeklyLimit: creditLimitNumber(snapshot.weeklyCreditLimit),
    },
    now,
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
  params: AcquireBindingParams,
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
  params: AcquireBindingParams,
  scope: BindingScope,
  now: Date,
  exclude: ReadonlySet<number>,
  replaced: boolean,
): Promise<PoolAttempt> {
  const pool = await loadUnboundPool(params.productLineId, params.protocol, exclude);
  const usageMap = await getCredentialQuotaUsage(
    pool.map((row) => row.credentialId),
    now,
  );

  const usable: Array<{ snapshot: CredentialSnapshotRow; credential: BoundCredential }> = [];
  const retryTimes: number[] = [];
  for (const snapshot of pool) {
    const usage = usageMap.get(snapshot.credentialId) ?? { fiveHourCredits: 0, weeklyCredits: 0 };
    const quota = evaluateCredentialQuota(
      usage,
      {
        fiveHourLimit: creditLimitNumber(snapshot.fiveHourCreditLimit),
        weeklyLimit: creditLimitNumber(snapshot.weeklyCreditLimit),
      },
      now,
    );
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
    usable.push({ snapshot, credential });
  }

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
      productLineId: params.productLineId,
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
    })
    .onConflictDoNothing();

  const reread = await loadScopeBinding(params.productLineId, scope);
  if (!reread) {
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
  if (verdict.kind === "exhausted") {
    await coolCredentialForQuota(reread.snapshot.credentialId, verdict.status, now);
  }
  await deleteBinding(reread.bindingId);
  return { kind: "retry", excludeMore: [reread.snapshot.credentialId, picked.snapshot.credentialId] };
}

async function restoreExpiredCooling(productLineId: number, now: Date): Promise<void> {
  await db
    .update(upstreamCredentials)
    .set({ status: "active", coolUntil: null, updatedAt: now })
    .where(
      and(
        eq(upstreamCredentials.status, "cooling"),
        or(isNull(upstreamCredentials.coolUntil), lte(upstreamCredentials.coolUntil, now)),
        eq(upstreamCredentials.productLineId, productLineId),
      ),
    );
}

async function loadScopeBinding(
  productLineId: number,
  scope: BindingScope,
): Promise<LoadedBinding | null> {
  const [locator] = await db
    .select({
      bindingId: credentialBindings.id,
      credentialId: credentialBindings.credentialId,
    })
    .from(credentialBindings)
    .where(
      and(
        eq(credentialBindings.productLineId, productLineId),
        eq(credentialBindings.scopeType, scope.scopeType),
        eq(credentialBindings.scopeId, scope.scopeId),
      ),
    )
    .limit(1)
    .then((rows): BindingLocatorRow[] => rows);
  if (!locator) return null;

  const snapshot = await loadCredentialSnapshot(locator.credentialId);
  if (!snapshot) {
    await deleteBinding(locator.bindingId);
    return null;
  }
  return { bindingId: locator.bindingId, snapshot };
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
  productLineId: number,
  protocol: RelayProtocol,
  exclude: ReadonlySet<number>,
): Promise<CredentialSnapshotRow[]> {
  return loadChannelPool(productLineId, protocol, exclude, true);
}

async function loadChannelPool(
  productLineId: number,
  protocol: RelayProtocol,
  exclude: ReadonlySet<number>,
  unboundOnly: boolean,
): Promise<CredentialSnapshotRow[]> {
  const excludeIds = [...exclude];
  const rows = await db
    .select(credentialSnapshotSelect)
    .from(upstreamCredentials)
    .innerJoin(productLines, eq(upstreamCredentials.productLineId, productLines.id))
    .innerJoin(providers, eq(productLines.providerId, providers.id))
    .leftJoin(credentialBindings, eq(credentialBindings.credentialId, upstreamCredentials.id))
    .where(
      and(
        eq(upstreamCredentials.productLineId, productLineId),
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

async function coolCredentialForQuota(
  credentialId: number,
  quota: CredentialQuotaStatus,
  now: Date,
): Promise<void> {
  if (!quota.exhaustedUntil) return;
  const coolUntilIso = quota.exhaustedUntil.toISOString();
  await db
    .update(upstreamCredentials)
    .set({
      status: sql`case
        when ${upstreamCredentials.status} in ('active', 'cooling')
        then 'cooling'::credential_status
        else ${upstreamCredentials.status}
      end`,
      // Quota windows are hours/days; take the later of the existing cooldown
      // and exhaustedUntil so a short rate-limit coolUntil is not preserved.
      coolUntil: sql`case
        when ${upstreamCredentials.status} in ('active', 'cooling')
        then greatest(
          coalesce(${upstreamCredentials.coolUntil}, ${coolUntilIso}::timestamptz),
          ${coolUntilIso}::timestamptz
        )
        else ${upstreamCredentials.coolUntil}
      end`,
      errorCount: sql`${upstreamCredentials.errorCount} + 1`,
      lastError: quotaExhaustedLastError(quota).slice(0, 1_000),
      lastErrorAt: now,
      lastUsedAt: now,
      updatedAt: now,
    })
    .where(eq(upstreamCredentials.id, credentialId));
}

async function deleteBinding(bindingId: number): Promise<void> {
  await db.delete(credentialBindings).where(eq(credentialBindings.id, bindingId));
}

function toBoundCredential(
  snapshot: CredentialSnapshotRow,
  protocol: RelayProtocol,
  now: Date,
): BoundCredential | null {
  const upstreamConfig = resolveProtocolUpstreamConfig({
    protocol,
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
