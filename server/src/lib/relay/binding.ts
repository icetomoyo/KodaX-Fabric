import {
  and,
  asc,
  desc,
  eq,
  gt,
  isNull,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  credentialBindings,
  employees,
  enterprises,
  productLines,
  providers,
  teamMembers,
  teams,
  upstreamCredentials,
} from "../../db/schema/index.js";
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
import type { RelayProtocol } from "./protocol.js";

export type BindingScopeType = "employee" | "team" | "enterprise";

export type BindingScope = {
  scopeType: BindingScopeType;
  scopeId: number;
};

export type ResolveBindingScopeInput = {
  employeeId: number;
  usageTier: UsageTier;
  teamId: number | null;
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
};

export type AcquireBindingResult =
  | { ok: true; credential: BoundCredential; bindingScope: BindingScope; replaced: boolean }
  | { ok: false; reason: "no_scope" | "exhausted_pool" | "no_binding_available"; retryAt: Date | null };

const MAX_POOL_ATTEMPTS = 3;

type EmployeeScopeRow = {
  usageTier: UsageTier;
  enterpriseId: number | null;
};

type TeamMembershipRow = {
  teamId: number;
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
 * heavy → exclusive employee Key; standard → team share, else enterprise;
 * light → enterprise share. Returns null when the required subject is missing.
 */
export function resolveBindingScope(input: ResolveBindingScopeInput): BindingScope | null {
  if (input.usageTier === "heavy") {
    return { scopeType: "employee", scopeId: input.employeeId };
  }
  if (input.usageTier === "standard") {
    if (input.teamId != null) {
      return { scopeType: "team", scopeId: input.teamId };
    }
    if (input.enterpriseId != null) {
      return { scopeType: "enterprise", scopeId: input.enterpriseId };
    }
    return null;
  }
  if (input.usageTier === "light") {
    if (input.enterpriseId != null) {
      return { scopeType: "enterprise", scopeId: input.enterpriseId };
    }
    return null;
  }
  return null;
}

/**
 * Load the employee's usage tier / org membership and resolve the binding scope.
 * Missing employees return null.
 */
export async function resolveEmployeeBindingScope(
  employeeId: number,
): Promise<BindingScope | null> {
  const [employee, membership] = await Promise.all([
    db
      .select({
        usageTier: employees.usageTier,
        enterpriseId: employees.enterpriseId,
      })
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1)
      .then((rows): EmployeeScopeRow | undefined => rows[0]),
    db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.employeeId, employeeId))
      .limit(1)
      .then((rows): TeamMembershipRow | undefined => rows[0]),
  ]);
  if (!employee) return null;
  return resolveBindingScope({
    employeeId,
    usageTier: employee.usageTier,
    teamId: membership?.teamId ?? null,
    enterpriseId: employee.enterpriseId,
  });
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
  const scope = await resolveEmployeeBindingScope(params.employeeId);
  if (!scope) {
    return { ok: false, reason: "no_scope", retryAt: null };
  }

  await restoreExpiredCooling(params.productLineId, now);

  const existing = await loadScopeBinding(params.productLineId, scope);
  if (existing) {
    const verdict = await inspectSnapshot(
      existing.snapshot,
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
    if (verdict.kind === "exhausted") {
      await coolCredentialForQuota(existing.snapshot.credentialId, verdict.status, now);
    }
    await deleteBinding(existing.bindingId);
    return bindFromPool(params, scope, now, true);
  }

  return bindFromPool(params, scope, now, false);
}

/**
 * Delete bindings whose scope subject no longer exists (or is disabled /
 * memberless). Credential deletes are already handled by ON DELETE CASCADE.
 * Intended for a later scheduled job.
 */
export async function releaseOrphanBindings(_now: Date = new Date()): Promise<number> {
  const deleted = await db
    .delete(credentialBindings)
    .where(
      sql`(
        (
          ${credentialBindings.scopeType} = 'employee'
          and not exists (
            select 1 from ${employees}
            where ${employees.id} = ${credentialBindings.scopeId}
              and ${employees.status} = 'active'
          )
        )
        or (
          ${credentialBindings.scopeType} = 'team'
          and (
            not exists (
              select 1 from ${teams}
              where ${teams.id} = ${credentialBindings.scopeId}
            )
            or not exists (
              select 1 from ${teamMembers}
              where ${teamMembers.teamId} = ${credentialBindings.scopeId}
            )
          )
        )
        or (
          ${credentialBindings.scopeType} = 'enterprise'
          and (
            not exists (
              select 1 from ${enterprises}
              where ${enterprises.id} = ${credentialBindings.scopeId}
            )
            or not exists (
              select 1 from ${employees}
              where ${employees.enterpriseId} = ${credentialBindings.scopeId}
                and ${employees.status} = 'active'
            )
          )
        )
      )`,
    )
    .returning({ id: credentialBindings.id });
  return deleted.length;
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
        isNull(credentialBindings.id),
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
  return rows.filter((row) => supportsProtocol(row.supportedProtocols, protocol));
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
