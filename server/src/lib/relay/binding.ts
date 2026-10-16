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
  effectiveKeyMaxConcurrency,
  effectiveKeyMaxMembers,
} from "./key-limits.js";
import {
  channelSeats,
  credentialBindingMembers,
  credentialBindings,
  employees,
  productLines,
  providers,
  upstreamCredentials,
} from "../../db/schema/index.js";
import {
  effectiveCredentialStatus,
  type CredentialStatus,
} from "../credential-status.js";
import {
  credentialWindowAnchors,
  effectiveWeeklyResetAt,
  getCredentialQuotaUsage,
  packageCreditLimits,
  remainingQuotaFraction,
  withInFlightEstimate,
  type CredentialQuotaUsage,
  type CredentialWindowAnchors,
} from "./credential-quota.js";
import {
  getCredentialLoad,
  getEmployeeInFlight,
} from "./credential-load.js";
import { type RelayProtocol } from "./protocol.js";
import {
  loadRelayPool,
  resolveRelayUpstreamConfig,
  type RelayPool,
} from "./channel-pool.js";

/**
 * 渠道 Key 调度：每个员工在一个调度池里挂在一把 Key 上（成员关系），
 * 一把 Key 最多挂 RELAY_KEY_MAX_MEMBERS 个员工、同时最多
 * RELAY_KEY_MAX_CONCURRENCY 个在途请求（默认 3 人、9 路；套餐可覆盖）。
 *
 * 每个员工同时最多 RELAY_EMPLOYEE_MAX_CONCURRENCY 路（默认 9，所有 Key 加起来）。
 * 到了这个数只 429，不解绑、不换 Key；没到而当前 Key 已满 9 路，就换绑到
 * 有空位的 Key，新请求发到新 Key，留在旧 Key 上的在途请求照常跑完。
 *
 * 持有人（channel_seats 上登记这把 Key 的员工）只有一点优先：挂 Key 时，
 * 自己持有的 Key 上还没有人，就先挂自己的；已经有人挂着，就和其他人一样挑。
 * 除此之外人人平等：
 * - 挑 Key 不看部门，按并发空位、优先级、剩余额度、当前人数（人少的先）选，
 *   大家摊到各把 Key 上。
 * - 绑定后粘住，只有当前 Key 不能用（停用、冷却、满 9 路、本次请求已失败）才换；
 *   持有人自己的 Key 空出来也不迁回去。
 * - 满员的 Key 谁都挂不进去，持有人也不能把别人挤下去。
 * - 额度以上游真实返回为准，本地估算不提前让出。
 *
 * 同一把 Key 上的成员都属于同一家企业；别的企业员工持有的 Key 不能借。
 * 绑定行只用 scope_type = 'enterprise' / scope_id 记成员所属的企业，
 * 不再有按团队、部门、个人划分的绑定范围。
 */
export type BindingScopeType = "employee" | "team" | "enterprise" | "department";

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
  /** 这把 Key 所属套餐的每把 Key 并发上限（套餐空值已折成全局默认）。 */
  keyMaxConcurrency: number;
  /** 这把 Key 所属套餐的每把 Key 人数上限（套餐空值已折成全局默认）。 */
  keyMaxMembers: number;
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
  keyMaxMembers: number | null;
  keyMaxConcurrency: number | null;
  meta: unknown;
};

/** A Key with who is on it now and who holds its seat. */
export type PoolKeyRow = CredentialSnapshotRow & {
  bindingId: number | null;
  bindingScopeType: BindingScopeType | null;
  bindingScopeId: number | null;
  memberCount: number;
  /** 持有人：channel_seats 上登记这把 Key 的员工；充值模式下管理员直接添加的 Key 没有。 */
  holderEmployeeId: number | null;
  holderEnterpriseId: number | null;
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
  | { kind: "busy" };

type RankedKey = {
  key: PoolKeyRow;
  credential: BoundCredential;
  /** 请求人持有这把 Key，且上面还没有人：挂 Key 时排第一。 */
  freeOwn: boolean;
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
  keyMaxMembers: productLines.keyMaxMembers,
  keyMaxConcurrency: productLines.keyMaxConcurrency,
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
  holderEmployeeId: channelSeats.employeeId,
  holderEnterpriseId: employees.enterpriseId,
};

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

/** 这把 Key 上已经挂着别的企业的人（一把 Key 上的成员只来自一家企业）。 */
function heldByOtherEnterprise(
  binding: { scopeType: BindingScopeType | null; scopeId: number | null },
  enterpriseId: number,
): boolean {
  return binding.scopeType !== "enterprise" || binding.scopeId !== enterpriseId;
}

export type CredentialMember = {
  employeeId: number;
  name: string;
  lastUsedAt: Date | null;
};

export type CredentialMembership = {
  /** 有绑定行（成员可能刚走光，还在宽限期里）。 */
  bound: boolean;
  members: CredentialMember[];
};

/** 每把渠道 Key 现在挂着谁；管理端各处显示绑定都用它，不再显示绑定范围。 */
export async function loadCredentialMembers(
  credentialIds: readonly number[],
): Promise<Map<number, CredentialMembership>> {
  const result = new Map<number, CredentialMembership>();
  if (credentialIds.length === 0) return result;
  const rows = await db
    .select({
      credentialId: credentialBindings.credentialId,
      employeeId: credentialBindingMembers.employeeId,
      name: employees.name,
      lastUsedAt: credentialBindingMembers.lastUsedAt,
    })
    .from(credentialBindings)
    .leftJoin(credentialBindingMembers, eq(credentialBindingMembers.bindingId, credentialBindings.id))
    .leftJoin(employees, eq(employees.id, credentialBindingMembers.employeeId))
    .where(inArray(credentialBindings.credentialId, [...credentialIds]))
    .orderBy(asc(credentialBindingMembers.createdAt), asc(credentialBindingMembers.id));
  for (const row of rows) {
    const entry = result.get(row.credentialId) ?? { bound: true, members: [] };
    if (row.employeeId != null) {
      entry.members.push({ employeeId: row.employeeId, name: row.name ?? "", lastUsedAt: row.lastUsedAt });
    }
    result.set(row.credentialId, entry);
  }
  return result;
}

/**
 * Return the Key this request should use.
 *
 * A bound employee keeps their Key while it is usable. Otherwise they join
 * the best Key by ranking: their own held Key first when nobody is on it,
 * then any Key by free slots, priority, headroom and fewest members.
 */
export async function acquireBoundCredential(
  params: AcquireBindingParams,
): Promise<AcquireBindingResult> {
  const now = params.now ?? new Date();
  const pool = params.pool ?? (await loadRelayPool(params.productLineId));
  if (!pool) {
    return { ok: false, reason: "no_binding_available", retryAt: null };
  }

  const [requester] = await db
    .select({ enterpriseId: employees.enterpriseId })
    .from(employees)
    .where(eq(employees.id, params.employeeId))
    .limit(1);
  if (!requester || requester.enterpriseId == null) {
    return { ok: false, reason: "no_scope", retryAt: null };
  }

  // 员工自己已满 9 路：429，不换 Key（换了也只是在别的 Key 上再多占几路）。
  if (getEmployeeInFlight(params.employeeId) >= env.RELAY_EMPLOYEE_MAX_CONCURRENCY) {
    return { ok: false, reason: "member_busy", retryAt: null };
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
    ), // 排序用全局默认，避免同一池里套餐上限不同时漂移。
  };

  // What the current Key contributes to the failure reason if nothing else fits.
  let currentBusy = false;
  let currentRetryAt: number | null = null;

  for (let round = 0; round < MAX_ACQUIRE_ROUNDS; round += 1) {
    const current = await loadMembership(ctx.employeeId, pool.key);

    if (current && !ctx.skip.has(current.key.credentialId)) {
      const usageMap = await loadUsage([current.key], now);
      const verdict = judgeKey(ctx, current.key, usageMap.get(current.key.credentialId));

      if (verdict.kind === "usable") {
        await touchMembership(current, now);
        return { ok: true, credential: verdict.credential };
      }

      // The current Key cannot serve this request: leave it for another one.
      currentBusy = verdict.kind === "busy";
      if (verdict.kind === "cooling") {
        currentRetryAt = verdict.until?.getTime() ?? null;
      }
      ctx.skip.add(current.key.credentialId);
    }

    const ranking = await rankPoolKeys(ctx);
    const pick = ranking.usable[0];
    if (!pick) {
      return rankingFailure(ranking, now, currentBusy, currentRetryAt);
    }
    const outcome = await joinKey(ctx, pick);
    if (outcome === "joined") return { ok: true, credential: pick.credential };
    if (outcome !== "retry") ctx.skip.add(pick.key.credentialId);
  }
  return { ok: false, reason: "no_binding_available", retryAt: null };
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
 * Decide whether one Key can serve this request. The same rule for everyone:
 * holders get no exemption. Pure given the usage ledger and the in-process
 * in-flight counters.
 */
function judgeKey(
  ctx: AcquireContext,
  key: PoolKeyRow,
  ledger: CredentialQuotaUsage | undefined,
): KeyVerdict {
  const status = effectiveCredentialStatus(key.credentialStatus, key.coolUntil, ctx.now);
  if (status === "cooling") return { kind: "cooling", until: key.coolUntil };
  if (status !== "active" || key.credentialWeight <= 0) return { kind: "unavailable" };
  if (!supportsProtocol(key.supportedProtocols, ctx.protocol)) return { kind: "unavailable" };
  if (ctx.requestExclude.has(key.credentialId)) return { kind: "excluded" };

  const inFlight = getCredentialLoad(key.credentialId).inFlight;
  const limits = packageCreditLimits(key);
  // 本地账本只用来排序（剩余额度），不拦人：额度以上游真实返回为准。
  const usage = withInFlightEstimate(
    ledger ?? { fiveHourCredits: 0, weeklyCredits: 0 },
    inFlight,
  );

  const freeSlots = effectiveKeyMaxConcurrency(key.keyMaxConcurrency) - inFlight;
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

/** Order every Key in the pool this employee could join right now. */
async function rankPoolKeys(ctx: AcquireContext): Promise<Ranking> {
  const ranking: Ranking = { usable: [], busy: false, full: false, retryTimes: [] };
  const keys = await loadPoolKeys({
    productLineIds: ctx.pool.activeProductLineIds,
    excludeCredentialIds: [...ctx.requestExclude],
    selectableOnly: true,
  });
  if (keys.length === 0) return ranking;
  const usageMap = await loadUsage(keys, ctx.now);

  const eligible: RankedKey[] = [];
  for (const key of keys) {
    if (ctx.skip.has(key.credentialId)) continue;
    const isOwn = key.holderEmployeeId === ctx.employeeId;
    // 别的企业员工持有的 Key 不能借；一把 Key 上的成员只来自一家企业。
    if (!isOwn && key.holderEmployeeId != null && key.holderEnterpriseId !== ctx.enterpriseId) {
      continue;
    }
    if (
      key.memberCount > 0 &&
      heldByOtherEnterprise({ scopeType: key.bindingScopeType, scopeId: key.bindingScopeId }, ctx.enterpriseId)
    ) {
      continue;
    }

    const verdict = judgeKey(ctx, key, usageMap.get(key.credentialId));
    if (verdict.kind === "cooling") {
      if (verdict.until) ranking.retryTimes.push(verdict.until.getTime());
      continue;
    }
    if (verdict.kind === "busy") {
      ranking.busy = true;
      continue;
    }
    if (verdict.kind !== "usable") continue;

    // 满员的 Key 谁都挂不进去，持有人也一样。
    if (key.memberCount >= effectiveKeyMaxMembers(key.keyMaxMembers)) {
      ranking.full = true;
      continue;
    }
    eligible.push({
      key,
      credential: verdict.credential,
      freeOwn: isOwn && key.memberCount === 0,
      headroom: verdict.headroom,
      fitsBurst: verdict.freeSlots >= ctx.neededSlots,
    });
  }
  if (eligible.length === 0) return ranking;

  // 持有人只有一点优先：自己的 Key 上还没有人就先挂自己的；其余不看部门、人人平等。
  const ranked = eligible;
  ranked.sort(
    (a, b) =>
      Number(b.freeOwn) - Number(a.freeOwn) ||
      Number(b.fitsBurst) - Number(a.fitsBurst) ||
      b.key.credentialPriority - a.key.credentialPriority ||
      b.headroom - a.headroom ||
      a.key.memberCount - b.key.memberCount ||
      b.key.credentialWeight - a.key.credentialWeight ||
      a.key.credentialId - b.key.credentialId,
  );
  ranking.usable = ranked;
  return ranking;
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
  const maxMembers = effectiveKeyMaxMembers(pick.key.keyMaxMembers);

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
      .select({ employeeId: credentialBindingMembers.employeeId })
      .from(credentialBindingMembers)
      .where(eq(credentialBindingMembers.bindingId, binding.id));
    if (heldByOtherEnterprise(binding, ctx.enterpriseId) && members.length > 0) return "foreign";

    const others = members.filter((member) => member.employeeId !== ctx.employeeId);
    if (others.length >= maxMembers) return "full";

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
    keyMaxConcurrency: effectiveKeyMaxConcurrency(snapshot.keyMaxConcurrency),
    keyMaxMembers: effectiveKeyMaxMembers(snapshot.keyMaxMembers),
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
