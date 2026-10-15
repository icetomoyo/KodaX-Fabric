import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import {
  channelSeats,
  credentialBindingMembers,
  credentialBindings,
  departments,
  employees,
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
import {
  AFFINITY_OWN,
  AFFINITY_SAME_ENTERPRISE,
  departmentAffinity,
  type AffinityDepartmentNode,
} from "./affinity.js";
import {
  credentialWindowAnchors,
  effectiveWeeklyResetAt,
  evaluateCredentialQuota,
  getCredentialQuotaUsage,
  packageCreditLimits,
  remainingQuotaFraction,
  withInFlightEstimate,
  type CredentialQuotaUsage,
  type CredentialWindowAnchors,
} from "./credential-quota.js";
import {
  getCredentialLoad,
  getEmployeeCredentialInFlight,
  getEmployeeInFlight,
} from "./credential-load.js";
import { type RelayProtocol } from "./protocol.js";
import { isOpenPoolProvider } from "./open-pool.js";
import {
  loadRelayPool,
  resolveRelayUpstreamConfig,
  type RelayPool,
} from "./channel-pool.js";

/**
 * 渠道 Key 调度：每个员工在一个调度池里挂在一把 Key 上（成员关系），
 * 一把 Key 最多挂 RELAY_KEY_MAX_MEMBERS 个员工、同时最多
 * RELAY_KEY_MAX_CONCURRENCY 个在途请求；同一员工在一把 Key 上最多
 * RELAY_KEY_MEMBER_CONCURRENCY 路。单人超额只 429，不解绑、不换 Key。
 *
 * 选 Key 按亲和度从高到低（见 affinity.ts）：本人的席位 Key 最优先，
 * 其次是编制上离得近的同事的 Key。绑定后粘住，只有当前 Key 不能用时才换。
 *
 * 席位主人（owner）和借用者（guest）的区别：
 * - 同一员工在一把 Key 上最多 RELAY_KEY_MEMBER_CONCURRENCY 路；超额只 429，
 *   不解绑、不换 Key。默认 3 人 × 3 路 = 9，已绑定的人不会因为并发去换 Key。
 * - 主人的 Key 被借满时，主人进来会让出最久没用的借用者。
 * - 主人的 Key 满并发时，主人只把这一次请求临时发到别的 Key，绑定不动；
 *   借用者遇到满并发则解绑，换到空位够的 Key。
 * - 主人和借用者默认都能用到 100%，以上游真实返回的限额为准；
 *   设了借用线（RELAY_GUEST_*_RATIO < 1）时，借用者用到借用线就让出。
 * - 主人不在自己的 Key 上时（冷却期间借了别人的），自己的 Key 一恢复就回去。
 *
 * 同一把 Key 上的成员都属于同一家企业；别的企业员工名下的 Key 不能借。
 */
export type BindingScopeType = "employee" | "team" | "enterprise" | "department";

export type BindingScope = {
  scopeType: BindingScopeType;
  scopeId: number;
};

export type BindingRole = "owner" | "guest";

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
  monthlyCreditLimit: number | null;
  fiveHourWindowAnchor: Date | null;
  fiveHourWindowBaseCredits: number;
  /** The weekly reset instant the Key follows: its own, else its package's. */
  weeklyWindowResetAt: Date | null;
  monthlyWindowResetAt: Date | null;
  meta: unknown;
};

export type AcquireBindingParams = {
  employeeId: number;
  productLineId: number;
  protocol: RelayProtocol;
  /** Pool already loaded by the caller for this product line. */
  pool?: RelayPool | null;
  now?: Date;
  /** Keys that already failed in this request. */
  excludeCredentialIds?: ReadonlySet<number>;
};

export type AcquireBindingResult =
  | {
      ok: true;
      credential: BoundCredential;
      role: BindingRole;
      /** This request only; the employee's binding was not changed. */
      transient: boolean;
      /** Self-hosted pool: no membership and no per-Key concurrency limit. */
      openPool: boolean;
    }
  | {
      ok: false;
      reason: "no_scope" | "exhausted_pool" | "pool_busy" | "member_busy" | "no_binding_available";
      retryAt: Date | null;
    };

/** A request re-evaluates at most this many times when it loses a race for a Key. */
const MAX_ACQUIRE_ROUNDS = 5;

/** An empty binding this recent may belong to a join that is still committing. */
const EMPTY_BINDING_GRACE_MS = 60_000;

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
  /** 套餐上的积分上限；渠道 Key 自己不设。 */
  fiveHourCreditLimit: string | null;
  weeklyCreditLimit: string | null;
  monthlyCreditLimit: string | null;
  fiveHourWindowAnchor: Date | null;
  fiveHourWindowBaseCredits: string;
  weeklyWindowResetAt: Date | null;
  lineWeeklyWindowResetAt: Date | null;
  lineMonthlyWindowResetAt: Date | null;
  meta: unknown;
};

/** A Key with who holds it now and whose seat it belongs to. */
export type PoolKeyRow = CredentialSnapshotRow & {
  bindingId: number | null;
  bindingScopeType: BindingScopeType | null;
  bindingScopeId: number | null;
  memberCount: number;
  ownerEmployeeId: number | null;
  ownerEnterpriseId: number | null;
};

type Membership = {
  memberId: number;
  lastUsedAt: Date | null;
  key: PoolKeyRow;
};

type AcquireContext = {
  employeeId: number;
  enterpriseId: number;
  protocol: RelayProtocol;
  pool: RelayPool;
  now: Date;
  /** Keys that failed earlier in this request. */
  requestExclude: ReadonlySet<number>;
  /** Keys this acquire found it cannot join (current Key unusable, lost a race). */
  skip: Set<number>;
  /** Free slots a Key should have so this employee's burst fits on it. */
  neededSlots: number;
};

type KeyVerdict =
  | { kind: "usable"; credential: BoundCredential; headroom: number; freeSlots: number }
  | { kind: "unavailable" }
  | { kind: "cooling"; until: Date | null }
  | { kind: "excluded" }
  | { kind: "guest_line"; until: Date | null }
  | { kind: "busy" }
  | { kind: "member_busy" };

type RankedKey = {
  key: PoolKeyRow;
  credential: BoundCredential;
  isOwn: boolean;
  affinity: number;
  headroom: number;
  fitsBurst: boolean;
};

type Ranking = {
  usable: RankedKey[];
  /** Some otherwise eligible Key was at its concurrency limit. */
  busy: boolean;
  /** Some otherwise eligible Key already had the maximum number of members. */
  full: boolean;
  retryTimes: number[];
};

type JoinOutcome = "joined" | "full" | "foreign" | "retry";

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
  fiveHourCreditLimit: productLines.fiveHourCreditLimit,
  weeklyCreditLimit: productLines.weeklyCreditLimit,
  monthlyCreditLimit: productLines.monthlyCreditLimit,
  fiveHourWindowAnchor: upstreamCredentials.fiveHourWindowAnchor,
  fiveHourWindowBaseCredits: upstreamCredentials.fiveHourWindowBaseCredits,
  weeklyWindowResetAt: upstreamCredentials.weeklyWindowResetAt,
  lineWeeklyWindowResetAt: productLines.weeklyWindowResetAt,
  lineMonthlyWindowResetAt: productLines.monthlyWindowResetAt,
  meta: upstreamCredentials.meta,
};

const poolKeySelect = {
  ...credentialSnapshotSelect,
  bindingId: credentialBindings.id,
  bindingScopeType: credentialBindings.scopeType,
  bindingScopeId: credentialBindings.scopeId,
  memberCount: sql<number>`(
    select count(*)::int
    from ${credentialBindingMembers}
    where ${credentialBindingMembers.bindingId} = ${credentialBindings.id}
  )`,
  ownerEmployeeId: channelSeats.employeeId,
  ownerEnterpriseId: employees.enterpriseId,
};

/** Usage ratios at which a guest gives a Key back to its owner. */
function guestQuotaRatios(): { fiveHour: number; weekly: number } {
  return {
    fiveHour: env.RELAY_GUEST_FIVE_HOUR_RATIO,
    weekly: env.RELAY_GUEST_WEEKLY_RATIO,
  };
}

/**
 * Release members who have not called through their Key for
 * RELAY_KEY_IDLE_RELEASE_SECONDS, then drop bindings nobody is on so the Key
 * returns to the unbound pool.
 */
export async function releaseIdleCredentialBindings(
  now: Date = new Date(),
): Promise<{ members: number; bindings: number }> {
  const idleCutoffIso = new Date(
    now.getTime() - env.RELAY_KEY_IDLE_RELEASE_SECONDS * 1_000,
  ).toISOString();
  const members = await db
    .delete(credentialBindingMembers)
    .where(
      sql`coalesce(${credentialBindingMembers.lastUsedAt}, ${credentialBindingMembers.createdAt}) < ${idleCutoffIso}::timestamptz`,
    )
    .returning({ id: credentialBindingMembers.id });

  // Every join bumps `updated_at`, so a binding a request is joining right now
  // is inside the grace window and is not swept from under it.
  const bindings = await db
    .delete(credentialBindings)
    .where(
      and(
        lt(credentialBindings.updatedAt, new Date(now.getTime() - EMPTY_BINDING_GRACE_MS)),
        sql`not exists (
          select 1 from ${credentialBindingMembers}
          where ${credentialBindingMembers.bindingId} = ${credentialBindings.id}
        )`,
      ),
    )
    .returning({ id: credentialBindings.id });
  return { members: members.length, bindings: bindings.length };
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

/**
 * Enterprise that currently owns a binding. Enterprise-scoped rows are the
 * scope itself; other scopes use the subject's `enterpriseId`.
 */
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

/**
 * Return the Key this request should use.
 *
 * A bound employee keeps their Key while it is usable. Otherwise the best
 * Key by affinity is joined (or, for an owner whose own Key is merely full,
 * borrowed for this one request).
 */
export async function acquireBoundCredential(
  params: AcquireBindingParams,
): Promise<AcquireBindingResult> {
  const now = params.now ?? new Date();
  const pool = params.pool ?? (await loadRelayPool(params.productLineId));
  if (!pool) {
    return { ok: false, reason: "no_binding_available", retryAt: null };
  }
  if (isOpenPoolProvider(pool.providerCode)) {
    return acquireOpenPoolCredential(params, now);
  }

  const [requester] = await db
    .select({ enterpriseId: employees.enterpriseId })
    .from(employees)
    .where(eq(employees.id, params.employeeId))
    .limit(1);
  if (!requester || requester.enterpriseId == null) {
    return { ok: false, reason: "no_scope", retryAt: null };
  }

  await restoreExpiredCooling(pool.productLineIds, now);

  const ctx: AcquireContext = {
    employeeId: params.employeeId,
    enterpriseId: requester.enterpriseId,
    protocol: params.protocol,
    pool,
    now,
    requestExclude: params.excludeCredentialIds ?? new Set(),
    skip: new Set(),
    neededSlots: Math.min(
      env.RELAY_KEY_MAX_CONCURRENCY,
      getEmployeeInFlight(params.employeeId) + 1,
    ),
  };

  // What the current Key contributes to the failure reason if nothing else fits.
  let currentBusy = false;
  let currentRetryAt: number | null = null;

  for (let round = 0; round < MAX_ACQUIRE_ROUNDS; round += 1) {
    const current = await loadMembership(ctx.employeeId, pool.key);

    if (current && !ctx.skip.has(current.key.credentialId)) {
      const role: BindingRole =
        current.key.ownerEmployeeId === ctx.employeeId ? "owner" : "guest";
      const usageMap = await loadUsage([current.key], now);
      const verdict = judgeKey(ctx, current.key, usageMap.get(current.key.credentialId), role);

      if (verdict.kind === "usable") {
        if (role === "guest") {
          // An owner borrowing someone else's Key goes home once their own works again.
          const home = await findUsableHomeKey(ctx);
          if (home) {
            const outcome = await joinKey(ctx, home);
            if (outcome === "joined") return granted(home.credential, "owner", false);
            if (outcome === "retry") continue;
          }
        }
        await touchMembership(current, now);
        return granted(verdict.credential, role, false);
      }

      if (verdict.kind === "member_busy") {
        await touchMembership(current, now);
        return { ok: false, reason: "member_busy", retryAt: null };
      }

      if (role === "owner" && (verdict.kind === "busy" || verdict.kind === "excluded")) {
        // Their own Key is only momentarily unusable: borrow for this request, stay bound.
        await touchMembership(current, now);
        ctx.skip.add(current.key.credentialId);
        const ranking = await rankPoolKeys(ctx, "transient");
        const pick = ranking.usable[0];
        if (pick) return granted(pick.credential, "guest", true);
        return rankingFailure(ranking, now, verdict.kind === "busy", null);
      }

      // Anyone else leaves this Key for another one.
      currentBusy = verdict.kind === "busy";
      if (verdict.kind === "cooling" || verdict.kind === "guest_line") {
        currentRetryAt = verdict.until?.getTime() ?? null;
      }
      ctx.skip.add(current.key.credentialId);
    }

    const ranking = await rankPoolKeys(ctx, "join");
    const pick = ranking.usable[0];
    if (!pick) {
      return rankingFailure(ranking, now, currentBusy, currentRetryAt);
    }
    const outcome = await joinKey(ctx, pick);
    if (outcome === "joined") {
      return granted(pick.credential, pick.isOwn ? "owner" : "guest", false);
    }
    if (outcome !== "retry") ctx.skip.add(pick.key.credentialId);
  }
  return { ok: false, reason: "no_binding_available", retryAt: null };
}

function granted(
  credential: BoundCredential,
  role: BindingRole,
  transient: boolean,
): AcquireBindingResult {
  return { ok: true, credential, role, transient, openPool: false };
}

function rankingFailure(
  ranking: Ranking,
  now: Date,
  currentBusy: boolean,
  currentRetryAt: number | null,
): AcquireBindingResult {
  if (ranking.busy || currentBusy) {
    return { ok: false, reason: "pool_busy", retryAt: null };
  }
  const retryTimes = currentRetryAt == null
    ? ranking.retryTimes
    : [...ranking.retryTimes, currentRetryAt];
  const retryAt = earliestFuture(retryTimes, now);
  if (retryAt || ranking.full) {
    return { ok: false, reason: "exhausted_pool", retryAt };
  }
  return { ok: false, reason: "no_binding_available", retryAt: null };
}

/**
 * Decide whether one Key can serve this request for the given role.
 * Pure given the usage ledger and the in-process in-flight counters.
 */
function judgeKey(
  ctx: AcquireContext,
  key: PoolKeyRow,
  ledger: CredentialQuotaUsage | undefined,
  role: BindingRole,
): KeyVerdict {
  const status = effectiveCredentialStatus(key.credentialStatus, key.coolUntil, ctx.now);
  if (status === "cooling") return { kind: "cooling", until: key.coolUntil };
  if (status !== "active" || key.credentialWeight <= 0) return { kind: "unavailable" };
  if (!supportsProtocol(key.supportedProtocols, ctx.protocol)) return { kind: "unavailable" };
  if (ctx.requestExclude.has(key.credentialId)) return { kind: "excluded" };

  const inFlight = getCredentialLoad(key.credentialId).inFlight;
  const mine = getEmployeeCredentialInFlight(ctx.employeeId, key.credentialId);
  if (mine >= env.RELAY_KEY_MEMBER_CONCURRENCY) return { kind: "member_busy" };
  const limits = packageCreditLimits(key);
  const usage = withInFlightEstimate(
    ledger ?? { fiveHourCredits: 0, weeklyCredits: 0 },
    inFlight,
  );
  if (role === "guest") {
    // 本地账本是推导值：只用来让借用者提前让出，不写冷却状态。
    const quota = evaluateCredentialQuota(
      usage,
      limits,
      ctx.now,
      snapshotAnchors(key),
      guestQuotaRatios(),
    );
    if (quota.exhausted) return { kind: "guest_line", until: quota.exhaustedUntil };
  }

  const freeSlots = env.RELAY_KEY_MAX_CONCURRENCY - inFlight;
  if (freeSlots <= 0) return { kind: "busy" };

  const credential = toBoundCredential(key, ctx.protocol, ctx.now);
  if (!credential) return { kind: "unavailable" };
  return {
    kind: "usable",
    credential,
    headroom: remainingQuotaFraction(usage, limits),
    freeSlots,
  };
}

/**
 * Order every Key in the pool this employee could use right now.
 * `join` ranks Keys to become a member of; `transient` ranks Keys an owner
 * may borrow for one request without joining.
 */
async function rankPoolKeys(
  ctx: AcquireContext,
  mode: "join" | "transient",
): Promise<Ranking> {
  const ranking: Ranking = { usable: [], busy: false, full: false, retryTimes: [] };
  const keys = await loadPoolKeys({
    productLineIds: ctx.pool.activeProductLineIds,
    excludeCredentialIds: [...ctx.requestExclude],
    selectableOnly: true,
  });
  if (keys.length === 0) return ranking;
  const usageMap = await loadUsage(keys, ctx.now);

  const eligible: Array<Omit<RankedKey, "affinity">> = [];
  for (const key of keys) {
    if (ctx.skip.has(key.credentialId)) continue;
    const isOwn = key.ownerEmployeeId === ctx.employeeId;
    // 别的企业员工名下的 Key 不能借；一把 Key 上的成员只来自一家企业。
    if (!isOwn && key.ownerEmployeeId != null && key.ownerEnterpriseId !== ctx.enterpriseId) {
      continue;
    }
    if (
      key.memberCount > 0 &&
      (key.bindingScopeType !== "enterprise" || key.bindingScopeId !== ctx.enterpriseId)
    ) {
      continue;
    }

    const verdict = judgeKey(ctx, key, usageMap.get(key.credentialId), isOwn ? "owner" : "guest");
    if (verdict.kind === "cooling" || verdict.kind === "guest_line") {
      if (verdict.until) ranking.retryTimes.push(verdict.until.getTime());
      continue;
    }
    if (verdict.kind === "member_busy") continue;
    if (verdict.kind === "busy") {
      ranking.busy = true;
      continue;
    }
    if (verdict.kind !== "usable") continue;

    // 满员的 Key 只有主人本人能进（进去时让出一个借用者）。
    if (key.memberCount >= env.RELAY_KEY_MAX_MEMBERS && !(mode === "join" && isOwn)) {
      ranking.full = true;
      continue;
    }
    eligible.push({
      key,
      credential: verdict.credential,
      isOwn,
      headroom: verdict.headroom,
      fitsBurst: verdict.freeSlots >= ctx.neededSlots,
    });
  }
  if (eligible.length === 0) return ranking;

  // 自己的 Key 可用时不需要再算别人的亲和度。
  const own = eligible.filter((item) => item.isOwn);
  const ranked: RankedKey[] = own.length > 0
    ? own.map((item) => ({ ...item, affinity: AFFINITY_OWN }))
    : await withAffinity(ctx, eligible);

  ranked.sort(
    (a, b) =>
      Number(b.fitsBurst) - Number(a.fitsBurst) ||
      b.affinity - a.affinity ||
      b.key.credentialPriority - a.key.credentialPriority ||
      b.headroom - a.headroom ||
      a.key.memberCount - b.key.memberCount ||
      b.key.credentialWeight - a.key.credentialWeight ||
      a.key.credentialId - b.key.credentialId,
  );
  ranking.usable = ranked;
  return ranking;
}

async function withAffinity(
  ctx: AcquireContext,
  items: ReadonlyArray<Omit<RankedKey, "affinity">>,
): Promise<RankedKey[]> {
  const ownerIds = [
    ...new Set(
      items
        .map((item) => item.key.ownerEmployeeId)
        .filter((id): id is number => id != null),
    ),
  ];
  if (ownerIds.length === 0) {
    return items.map((item) => ({ ...item, affinity: AFFINITY_SAME_ENTERPRISE }));
  }

  const [membershipRows, nodes] = await Promise.all([
    db
      .select({ employeeId: teamMembers.employeeId, departmentId: teams.departmentId })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(inArray(teamMembers.employeeId, [ctx.employeeId, ...ownerIds])),
    db
      .select({ id: departments.id, parentId: departments.parentId })
      .from(departments)
      .where(eq(departments.enterpriseId, ctx.enterpriseId)),
  ]);
  const departmentsByEmployee = new Map<number, number[]>();
  for (const row of membershipRows) {
    const list = departmentsByEmployee.get(row.employeeId) ?? [];
    list.push(row.departmentId);
    departmentsByEmployee.set(row.employeeId, list);
  }
  const mine = departmentsByEmployee.get(ctx.employeeId) ?? [];
  const treeNodes: AffinityDepartmentNode[] = nodes;

  return items.map((item) => {
    const ownerId = item.key.ownerEmployeeId;
    // 没有席位主人的 Key（充值模式）谈不上亲疏，和「只是同企业」同分。
    const affinity = ownerId == null
      ? AFFINITY_SAME_ENTERPRISE
      : departmentAffinity(mine, departmentsByEmployee.get(ownerId) ?? [], treeNodes);
    return { ...item, affinity };
  });
}

/**
 * The requester's own seat Key in this pool, when it can serve them now.
 * Only consulted while they are bound to someone else's Key.
 */
async function findUsableHomeKey(ctx: AcquireContext): Promise<RankedKey | null> {
  if (ctx.pool.activeProductLineIds.length === 0) return null;
  const seatRows = await db
    .select({ credentialId: upstreamCredentials.id })
    .from(channelSeats)
    .innerJoin(upstreamCredentials, eq(upstreamCredentials.id, channelSeats.credentialId))
    .where(
      and(
        eq(channelSeats.employeeId, ctx.employeeId),
        inArray(upstreamCredentials.productLineId, [...ctx.pool.activeProductLineIds]),
      ),
    );
  const credentialIds = seatRows
    .map((row) => row.credentialId)
    .filter((id) => !ctx.skip.has(id));
  if (credentialIds.length === 0) return null;

  const keys = await loadPoolKeys({ credentialIds, selectableOnly: true });
  const usageMap = await loadUsage(keys, ctx.now);
  let best: RankedKey | null = null;
  for (const key of keys) {
    if (
      key.memberCount > 0 &&
      (key.bindingScopeType !== "enterprise" || key.bindingScopeId !== ctx.enterpriseId)
    ) {
      continue;
    }
    const verdict = judgeKey(ctx, key, usageMap.get(key.credentialId), "owner");
    if (verdict.kind !== "usable") continue;
    if (!best || verdict.headroom > best.headroom) {
      best = {
        key,
        credential: verdict.credential,
        isOwn: true,
        affinity: AFFINITY_OWN,
        headroom: verdict.headroom,
        fitsBurst: verdict.freeSlots >= ctx.neededSlots,
      };
    }
  }
  return best;
}

/**
 * Become a member of `pick`, leaving whichever Key this employee was on in
 * the pool. One transaction, serialized per Key by a row lock on its binding,
 * so the member limit and the one-enterprise-per-Key rule hold under races.
 */
async function joinKey(ctx: AcquireContext, pick: RankedKey): Promise<JoinOutcome> {
  const credentialId = pick.key.credentialId;
  const productLineId = pick.key.productLineId;
  const poolKey = ctx.pool.key;
  const maxMembers = env.RELAY_KEY_MAX_MEMBERS;

  return db.transaction(async (tx) => {
    await tx
      .insert(credentialBindings)
      .values({
        credentialId,
        productLineId,
        relayPoolKey: poolKey,
        scopeType: "enterprise",
        scopeId: ctx.enterpriseId,
      })
      .onConflictDoNothing({ target: credentialBindings.credentialId });
    await tx.execute(
      sql`select id from credential_bindings where credential_id = ${credentialId} for update`,
    );
    const [binding] = await tx
      .select({
        id: credentialBindings.id,
        scopeType: credentialBindings.scopeType,
        scopeId: credentialBindings.scopeId,
      })
      .from(credentialBindings)
      .where(eq(credentialBindings.credentialId, credentialId))
      .limit(1);
    if (!binding) return "retry";

    const members = await tx
      .select({
        id: credentialBindingMembers.id,
        employeeId: credentialBindingMembers.employeeId,
        lastUsedAt: credentialBindingMembers.lastUsedAt,
        createdAt: credentialBindingMembers.createdAt,
      })
      .from(credentialBindingMembers)
      .where(eq(credentialBindingMembers.bindingId, binding.id));
    const heldByOtherEnterprise =
      binding.scopeType !== "enterprise" || binding.scopeId !== ctx.enterpriseId;
    if (heldByOtherEnterprise && members.length > 0) return "foreign";

    const others = members.filter((member) => member.employeeId !== ctx.employeeId);
    if (others.length >= maxMembers) {
      if (!pick.isOwn) return "full";
      // 主人回到自己的 Key：让出最久没用的借用者，他们下次请求会换到别的 Key。
      const lastTouch = (member: (typeof others)[number]) =>
        (member.lastUsedAt ?? member.createdAt).getTime();
      const evicted = [...others]
        .sort((a, b) => lastTouch(a) - lastTouch(b) || a.id - b.id)
        .slice(0, others.length - (maxMembers - 1));
      await tx
        .delete(credentialBindingMembers)
        .where(inArray(credentialBindingMembers.id, evicted.map((member) => member.id)));
    }

    await tx
      .update(credentialBindings)
      .set({
        productLineId,
        relayPoolKey: poolKey,
        scopeType: "enterprise",
        scopeId: ctx.enterpriseId,
        ...(members.length === 0 ? { boundAt: ctx.now } : {}),
        updatedAt: ctx.now,
      })
      .where(eq(credentialBindings.id, binding.id));

    await tx
      .delete(credentialBindingMembers)
      .where(
        and(
          eq(credentialBindingMembers.employeeId, ctx.employeeId),
          eq(credentialBindingMembers.relayPoolKey, poolKey),
          ne(credentialBindingMembers.bindingId, binding.id),
        ),
      );
    await tx
      .insert(credentialBindingMembers)
      .values({
        bindingId: binding.id,
        employeeId: ctx.employeeId,
        productLineId,
        relayPoolKey: poolKey,
        lastUsedAt: ctx.now,
      })
      .onConflictDoNothing();

    // A concurrent request of the same employee may have joined a different Key.
    const [mine] = await tx
      .select({ bindingId: credentialBindingMembers.bindingId })
      .from(credentialBindingMembers)
      .where(
        and(
          eq(credentialBindingMembers.employeeId, ctx.employeeId),
          eq(credentialBindingMembers.relayPoolKey, poolKey),
        ),
      )
      .limit(1);
    return mine?.bindingId === binding.id ? "joined" : "retry";
  });
}

async function loadMembership(
  employeeId: number,
  relayPoolKey: string,
): Promise<Membership | null> {
  const [row] = await db
    .select({
      memberId: credentialBindingMembers.id,
      lastUsedAt: credentialBindingMembers.lastUsedAt,
      credentialId: credentialBindings.credentialId,
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
  const [key] = await loadPoolKeys({ credentialIds: [row.credentialId], selectableOnly: false });
  if (!key) {
    await db
      .delete(credentialBindingMembers)
      .where(eq(credentialBindingMembers.id, row.memberId));
    return null;
  }
  return { memberId: row.memberId, lastUsedAt: row.lastUsedAt, key };
}

/** Keep the member alive for idle release without writing on every request. */
async function touchMembership(membership: Membership, now: Date): Promise<void> {
  const touchIntervalMs = Math.min(60_000, env.RELAY_KEY_IDLE_RELEASE_SECONDS * 250);
  if (
    membership.lastUsedAt &&
    now.getTime() - membership.lastUsedAt.getTime() < touchIntervalMs
  ) {
    return;
  }
  await db
    .update(credentialBindingMembers)
    .set({ lastUsedAt: now })
    .where(eq(credentialBindingMembers.id, membership.memberId));
}

export async function loadPoolKeys(filter: {
  productLineIds?: readonly number[];
  credentialIds?: readonly number[];
  excludeCredentialIds?: readonly number[];
  /** Only Keys scheduling may pick: active or cooling, with a positive weight. */
  selectableOnly: boolean;
}): Promise<PoolKeyRow[]> {
  if (filter.productLineIds && filter.productLineIds.length === 0) return [];
  if (filter.credentialIds && filter.credentialIds.length === 0) return [];
  const rows = await db
    .select(poolKeySelect)
    .from(upstreamCredentials)
    .innerJoin(productLines, eq(upstreamCredentials.productLineId, productLines.id))
    .innerJoin(providers, eq(productLines.providerId, providers.id))
    .leftJoin(credentialBindings, eq(credentialBindings.credentialId, upstreamCredentials.id))
    .leftJoin(channelSeats, eq(channelSeats.credentialId, upstreamCredentials.id))
    .leftJoin(employees, eq(employees.id, channelSeats.employeeId))
    .where(
      and(
        filter.productLineIds
          ? inArray(upstreamCredentials.productLineId, [...filter.productLineIds])
          : undefined,
        filter.credentialIds
          ? inArray(upstreamCredentials.id, [...filter.credentialIds])
          : undefined,
        filter.excludeCredentialIds && filter.excludeCredentialIds.length > 0
          ? notInArray(upstreamCredentials.id, [...filter.excludeCredentialIds])
          : undefined,
        filter.selectableOnly
          ? and(
              gt(upstreamCredentials.weight, 0),
              or(
                eq(upstreamCredentials.status, "active"),
                eq(upstreamCredentials.status, "cooling"),
              ),
            )
          : undefined,
      ),
    );
  return rows.map((row) => ({ ...row, memberCount: Number(row.memberCount) || 0 }));
}

export async function loadUsage(
  keys: readonly CredentialSnapshotRow[],
  now: Date,
): Promise<Map<number, CredentialQuotaUsage>> {
  return getCredentialQuotaUsage(
    keys.map((key) => key.credentialId),
    now,
    anchorsMapFromSnapshots(keys),
  );
}

/** Per-Key upstream window state carried on credential snapshots. */
function snapshotAnchors(snapshot: CredentialSnapshotRow): CredentialWindowAnchors {
  return credentialWindowAnchors(snapshot);
}

function anchorsMapFromSnapshots(
  snapshots: readonly CredentialSnapshotRow[],
): Map<number, CredentialWindowAnchors> {
  return new Map(
    snapshots.map((snapshot) => [snapshot.credentialId, snapshotAnchors(snapshot)]),
  );
}

/**
 * Self-hosted channels keep no bindings: every request picks the Key with the
 * most quota headroom from the whole pool.
 */
async function acquireOpenPoolCredential(
  params: AcquireBindingParams,
  now: Date,
): Promise<AcquireBindingResult> {
  await restoreExpiredCooling([params.productLineId], now);
  const pool = await loadOpenPool(
    [params.productLineId],
    params.protocol,
    params.excludeCredentialIds ?? new Set(),
  );
  const usageMap = await loadUsage(pool, now);
  const usable: Array<{
    snapshot: CredentialSnapshotRow;
    credential: BoundCredential;
    headroom: number;
  }> = [];
  const retryTimes: number[] = [];
  for (const snapshot of pool) {
    const limits = packageCreditLimits(snapshot);
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
      role: "guest",
      transient: true,
      openPool: true,
    };
  }
  if (retryTimes.length) {
    return { ok: false, reason: "exhausted_pool", retryAt: earliestFuture(retryTimes, now) };
  }
  return { ok: false, reason: "no_binding_available", retryAt: null };
}

async function loadOpenPool(
  productLineIds: readonly number[],
  protocol: RelayProtocol,
  exclude: ReadonlySet<number>,
): Promise<CredentialSnapshotRow[]> {
  if (productLineIds.length === 0) return [];
  const excludeIds = [...exclude];
  const rows = await db
    .select(credentialSnapshotSelect)
    .from(upstreamCredentials)
    .innerJoin(productLines, eq(upstreamCredentials.productLineId, productLines.id))
    .innerJoin(providers, eq(productLines.providerId, providers.id))
    .where(
      and(
        inArray(upstreamCredentials.productLineId, [...productLineIds]),
        gt(upstreamCredentials.weight, 0),
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

export async function restoreExpiredCooling(productLineIds: readonly number[], now: Date): Promise<void> {
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

export function toBoundCredential(
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
  const limits = packageCreditLimits(snapshot);
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
    fiveHourCreditLimit: limits.fiveHourLimit,
    weeklyCreditLimit: limits.weeklyLimit,
    monthlyCreditLimit: limits.monthlyLimit ?? null,
    fiveHourWindowAnchor: snapshot.fiveHourWindowAnchor,
    fiveHourWindowBaseCredits: Number(snapshot.fiveHourWindowBaseCredits) || 0,
    weeklyWindowResetAt: effectiveWeeklyResetAt(snapshot),
    monthlyWindowResetAt: snapshot.lineMonthlyWindowResetAt,
    meta: snapshot.meta,
  };
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
