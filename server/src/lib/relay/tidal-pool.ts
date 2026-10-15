import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import { employees } from "../../db/schema/index.js";
import { effectiveCredentialStatus } from "../credential-status.js";
import {
  loadPoolKeys,
  loadUsage,
  restoreExpiredCooling,
  toBoundCredential,
  type BoundCredential,
  type PoolKeyRow,
} from "./binding.js";
import type { RelayPool } from "./channel-pool.js";
import {
  getCredentialLoad,
  getTidalInFlight,
  tryBeginCredentialUse,
} from "./credential-load.js";
import {
  packageCreditLimits,
  withInFlightEstimate,
  type CredentialQuotaUsage,
} from "./credential-quota.js";
import type { RelayProtocol } from "./protocol.js";
import { loadTidalSettings, type TidalSettings } from "./tidal-settings.js";

/**
 * 潮汐池：潮汐KEY 的每次请求从整个调度池里挑一把闲置的渠道 Key，用完即走。
 *
 * 和绑定调度（binding.ts）的区别：
 * - 不加入成员关系，不占一把 Key 的 3 人名额。
 * - 只用没人在用的 Key：Key 上有成员（主人或借用者最近用过）就不选它。
 * - 铺得薄：每把 Key 上的潮汐在途不超过 perKeyConcurrency，靠 Key 的数量撑起总并发。
 *   集中在少数几把 Key 上会很快打满 5 小时额度，主人第二天早上就用不了。
 * - 先用周用量最低的档位，同一档内选负载最轻的；用量到了借用线的 Key 不用。
 * - 同一个会话尽量落在同一把 Key 上（上游的提示缓存按账号隔离）。
 */
export type TidalRequest = {
  /** The tidal Key the request came in on. */
  apiKeyId: number;
  /** Stable per-conversation key, when the client sent one. */
  sessionKey: string | null;
};

export type AcquireTidalParams = {
  employeeId: number;
  pool: RelayPool;
  protocol: RelayProtocol;
  tidal: TidalRequest;
  excludeCredentialIds?: ReadonlySet<number>;
  now?: Date;
};

export type AcquireTidalResult =
  | {
      ok: true;
      credential: BoundCredential;
      /** The Key's concurrency slot, already taken; the caller must release it. */
      release: () => void;
    }
  | { ok: false; reason: "no_scope" | "pool_busy" | "no_binding_available" };

/** Why a Key is not offered to tidal requests right now. */
export type TidalSkipReason =
  | "unavailable"
  | "cooling"
  | "foreign"
  | "in_use"
  | "weekly_line"
  | "monthly_line"
  | "five_hour_line"
  | "busy";

export type TidalKeyState =
  | {
      usable: true;
      tier: number;
      weeklyRatio: number;
      fiveHourRatio: number;
      credential: BoundCredential;
    }
  | { usable: false; reason: TidalSkipReason; weeklyRatio: number; fiveHourRatio: number };

type PoolSnapshot = {
  keys: PoolKeyRow[];
  usage: Map<number, CredentialQuotaUsage>;
};

const SESSION_TTL_MS = 15 * 60_000;
const MAX_SESSIONS = 10_000;

const snapshots = new Map<string, { at: number; value: Promise<PoolSnapshot> }>();
const sessions = new Map<string, { credentialId: number; lastAt: number }>();
let sessionsPrunedAt = 0;

/**
 * Keys of the pool with their usage ledger. Every tidal request looks at the
 * whole pool, so the snapshot is shared for a short while; in-flight counts
 * are read live from memory and are never stale.
 */
async function loadPoolSnapshot(pool: RelayPool, now: Date): Promise<PoolSnapshot> {
  const cached = snapshots.get(pool.key);
  if (cached && now.getTime() - cached.at < env.RELAY_TIDAL_SNAPSHOT_TTL_MS) {
    return cached.value;
  }
  const value = (async () => {
    await restoreExpiredCooling(pool.productLineIds, now);
    const keys = await loadPoolKeys({
      productLineIds: pool.activeProductLineIds,
      selectableOnly: true,
    });
    return { keys, usage: await loadUsage(keys, now) };
  })();
  snapshots.set(pool.key, { at: now.getTime(), value });
  try {
    return await value;
  } catch (error) {
    if (snapshots.get(pool.key)?.value === value) snapshots.delete(pool.key);
    throw error;
  }
}

function ratioOf(used: number, limit: number | null): number {
  return limit != null && limit > 0 ? used / limit : 0;
}

/**
 * Decide whether one Key can take a tidal request. Pure given the snapshot
 * row, the ledger and the in-process in-flight counters.
 */
export function judgeTidalKey(input: {
  key: PoolKeyRow;
  ledger: CredentialQuotaUsage | undefined;
  settings: TidalSettings;
  protocol: RelayProtocol;
  /** Null skips the enterprise check (admin preview). */
  enterpriseId: number | null;
  now: Date;
}): TidalKeyState {
  const { key, settings, now } = input;
  const inFlight = getCredentialLoad(key.credentialId).inFlight;
  const limits = packageCreditLimits(key);
  const usage = withInFlightEstimate(
    input.ledger ?? { fiveHourCredits: 0, weeklyCredits: 0 },
    inFlight,
  );
  const weeklyRatio = ratioOf(usage.weeklyCredits, limits.weeklyLimit);
  const fiveHourRatio = ratioOf(usage.fiveHourCredits, limits.fiveHourLimit);
  const monthlyRatio = ratioOf(usage.monthlyCredits ?? 0, limits.monthlyLimit ?? null);
  const skip = (reason: TidalSkipReason): TidalKeyState => ({
    usable: false,
    reason,
    weeklyRatio,
    fiveHourRatio,
  });

  const status = effectiveCredentialStatus(key.credentialStatus, key.coolUntil, now);
  if (status === "cooling") return skip("cooling");
  if (status !== "active" || key.credentialWeight <= 0) return skip("unavailable");
  if (!key.supportedProtocols?.includes(input.protocol)) return skip("unavailable");
  // 别的企业员工名下的 Key 不能借。
  if (
    input.enterpriseId != null &&
    key.ownerEmployeeId != null &&
    key.ownerEnterpriseId !== input.enterpriseId
  ) {
    return skip("foreign");
  }
  // 有成员就是有人在用（成员闲置 30 分钟才释放）：潮汐让开。
  if (key.memberCount > 0) return skip("in_use");
  if (weeklyRatio >= settings.weeklyLine) return skip("weekly_line");
  // 月额度和周额度一样是长窗口，沿用周用量线。
  if (monthlyRatio >= settings.weeklyLine) return skip("monthly_line");
  if (fiveHourRatio >= settings.fiveHourLine) return skip("five_hour_line");
  if (
    getTidalInFlight(key.credentialId) >= settings.perKeyConcurrency ||
    inFlight >= env.RELAY_KEY_MAX_CONCURRENCY
  ) {
    return skip("busy");
  }

  const credential = toBoundCredential(key, input.protocol, now);
  if (!credential) return skip("unavailable");
  const tierIndex = settings.weeklyTiers.findIndex((bound) => weeklyRatio < bound);
  return {
    usable: true,
    tier: tierIndex === -1 ? settings.weeklyTiers.length : tierIndex,
    weeklyRatio,
    fiveHourRatio,
    credential,
  };
}

function pruneSessions(nowMs: number): void {
  if (nowMs - sessionsPrunedAt < 1_000 && sessions.size < MAX_SESSIONS) return;
  sessionsPrunedAt = nowMs;
  for (const [key, entry] of sessions) {
    if (nowMs - entry.lastAt >= SESSION_TTL_MS) sessions.delete(key);
  }
  // Oldest first: a Map iterates in insertion order and entries are re-inserted on use.
  for (const key of sessions.keys()) {
    if (sessions.size < MAX_SESSIONS) break;
    sessions.delete(key);
  }
}

function rememberSession(sessionKey: string, credentialId: number, nowMs: number): void {
  sessions.delete(sessionKey);
  sessions.set(sessionKey, { credentialId, lastAt: nowMs });
}

/** How many live sessions are parked on each Key. */
function sessionCounts(): Map<number, number> {
  const counts = new Map<number, number>();
  for (const entry of sessions.values()) {
    counts.set(entry.credentialId, (counts.get(entry.credentialId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Pick a Key for one tidal request and take its concurrency slot.
 *
 * Picking and taking the slot happen in one synchronous turn, so a burst of
 * requests spreads over the pool instead of all choosing the same Key and
 * then colliding on its limit.
 */
export async function acquireTidalCredential(
  params: AcquireTidalParams,
): Promise<AcquireTidalResult> {
  const now = params.now ?? new Date();
  const [settings, [requester], snapshot] = await Promise.all([
    loadTidalSettings(),
    db
      .select({ enterpriseId: employees.enterpriseId })
      .from(employees)
      .where(eq(employees.id, params.employeeId))
      .limit(1),
    loadPoolSnapshot(params.pool, now),
  ]);
  if (!requester || requester.enterpriseId == null) return { ok: false, reason: "no_scope" };
  if (snapshot.keys.length === 0) return { ok: false, reason: "no_binding_available" };

  // No await below this line: the in-flight counters must not move between
  // ranking the Keys and taking a slot on one of them.
  const nowMs = now.getTime();
  pruneSessions(nowMs);
  const exclude = params.excludeCredentialIds ?? new Set<number>();
  const parked = sessionCounts();
  type Usable = Extract<TidalKeyState, { usable: true }>;
  const usable: Array<{ key: PoolKeyRow; state: Usable }> = [];
  const stateById = new Map<number, TidalKeyState>();
  for (const key of snapshot.keys) {
    if (exclude.has(key.credentialId)) continue;
    const state = judgeTidalKey({
      key,
      ledger: snapshot.usage.get(key.credentialId),
      settings,
      protocol: params.protocol,
      enterpriseId: requester.enterpriseId,
      now,
    });
    stateById.set(key.credentialId, state);
    if (state.usable) usable.push({ key, state });
  }

  const take = (credentialId: number) =>
    tryBeginCredentialUse(credentialId, {
      virtualKeyId: params.tidal.apiKeyId,
      employeeId: params.employeeId,
      limit: env.RELAY_KEY_MAX_CONCURRENCY,
      tidalLimit: settings.perKeyConcurrency,
    });

  const sessionKey = params.tidal.sessionKey;
  const sticky = sessionKey ? sessions.get(sessionKey) : undefined;
  // 粘着的 Key 只是暂时满并发时，这一次请求溢出到别的 Key，会话不搬家。
  let keepSession = false;
  if (sessionKey && sticky) {
    const state = stateById.get(sticky.credentialId);
    if (state?.usable) {
      const release = take(sticky.credentialId);
      if (release) {
        rememberSession(sessionKey, sticky.credentialId, nowMs);
        return { ok: true, credential: state.credential, release };
      }
    }
    // 这次请求里它刚失败过（已排除）也只算暂时的；其余情况（停用、冷却、
    // 有人在用、用量越线）会话换到新挑的 Key 上。
    keepSession =
      exclude.has(sticky.credentialId) ||
      (state != null && (state.usable || state.reason === "busy"));
    if (keepSession) rememberSession(sessionKey, sticky.credentialId, nowMs);
  }

  usable.sort(
    (a, b) =>
      a.state.tier - b.state.tier ||
      getTidalInFlight(a.key.credentialId) - getTidalInFlight(b.key.credentialId) ||
      (parked.get(a.key.credentialId) ?? 0) - (parked.get(b.key.credentialId) ?? 0) ||
      getCredentialLoad(a.key.credentialId).inFlight -
        getCredentialLoad(b.key.credentialId).inFlight ||
      a.state.weeklyRatio - b.state.weeklyRatio ||
      a.key.credentialId - b.key.credentialId,
  );
  for (const { key, state } of usable) {
    const release = take(key.credentialId);
    if (!release) continue;
    if (sessionKey && !keepSession) rememberSession(sessionKey, key.credentialId, nowMs);
    return { ok: true, credential: state.credential, release };
  }
  return { ok: false, reason: "pool_busy" };
}

/**
 * Conversation key for stickiness: an explicit header wins, then the fields
 * agent clients already send per conversation.
 */
export function tidalSessionKey(
  apiKeyId: number,
  headers: Record<string, string | string[] | undefined>,
  body: unknown,
): string | null {
  const header = headers["x-session-id"];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const metadata =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? (record.metadata as Record<string, unknown>)
      : {};
  const raw = [fromHeader, metadata.user_id, record.prompt_cache_key, record.user].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  if (!raw) return null;
  return `${apiKeyId}:${createHash("sha256").update(raw.trim()).digest("base64url")}`;
}

export type TidalPoolPreview = {
  total: number;
  /** Usable Keys per weekly-usage tier, lowest tier first. */
  usableByTier: number[];
  skipped: Record<TidalSkipReason, number>;
  tidalInFlight: number;
};

/** What tidal requests would see in this pool right now (admin view). */
export async function previewTidalPool(
  pool: RelayPool,
  protocol: RelayProtocol,
  now: Date = new Date(),
): Promise<TidalPoolPreview> {
  const [settings, snapshot] = await Promise.all([
    loadTidalSettings(),
    loadPoolSnapshot(pool, now),
  ]);
  const preview: TidalPoolPreview = {
    total: snapshot.keys.length,
    usableByTier: settings.weeklyTiers.map(() => 0).concat(0),
    skipped: {
      unavailable: 0,
      cooling: 0,
      foreign: 0,
      in_use: 0,
      weekly_line: 0,
      monthly_line: 0,
      five_hour_line: 0,
      busy: 0,
    },
    tidalInFlight: 0,
  };
  for (const key of snapshot.keys) {
    preview.tidalInFlight += getTidalInFlight(key.credentialId);
    const state = judgeTidalKey({
      key,
      ledger: snapshot.usage.get(key.credentialId),
      settings,
      protocol,
      enterpriseId: null,
      now,
    });
    if (state.usable) preview.usableByTier[state.tier] += 1;
    else preview.skipped[state.reason] += 1;
  }
  return preview;
}
