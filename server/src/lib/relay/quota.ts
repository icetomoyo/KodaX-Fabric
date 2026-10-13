import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import { teams } from "../../db/schema/index.js";
import { redis } from "../../redis.js";
import {
  isTidalWindowOpen,
  loadTidalSettings,
  tidalWindowLabel,
} from "./tidal-settings.js";
import type { RelayTidalGrant } from "./types.js";

export type RelayQuotaLease = {
  release: () => Promise<void>;
};

export class RelayLimitError extends Error {
  readonly code: string;
  readonly retryAfterSeconds?: number;

  constructor(message: string, code: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "RelayLimitError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const PERMISSION_LIMIT_CODES = new Set([
  "enterprise_required",
  "team_required",
  // 潮汐KEY 在总开关关闭或开放时段之外：重试没有意义，不按限流回 429。
  "tidal_disabled",
  "tidal_window_closed",
]);

export function relayLimitResponse(error: RelayLimitError): {
  status: 403 | 429;
  type: "permission_error" | "rate_limit_error";
} {
  if (PERMISSION_LIMIT_CODES.has(error.code)) {
    return { status: 403, type: "permission_error" };
  }
  return { status: 429, type: "rate_limit_error" };
}

export function assertTeamBound(teamId: number | null | undefined): asserts teamId is number {
  if (teamId == null) {
    throw new RelayLimitError("API Key 未绑定团队，无法转发", "team_required");
  }
}

async function ensureRedisReady() {
  if (redis.status === "ready") return;
  // Sending a command is safe while ioredis is connecting/reconnecting: it is
  // queued until the connection is ready. Calling connect() here can race with
  // another request and throw "already connecting".
  const pong = await redis.ping();
  if (pong !== "PONG") throw new Error("Redis PING failed");
}

/** `subject` is the employee id, or `tidal:<key id>` for a tidal Key's own limits. */
async function acquireRpm(subject: string, limit: number) {
  const minute = Math.floor(Date.now() / 60_000);
  const key = `tokenhub:relay:rpm:${subject}:${minute}`;
  const script = `
    local current = redis.call("INCR", KEYS[1])
    if current == 1 then redis.call("EXPIRE", KEYS[1], ARGV[2]) end
    if current > tonumber(ARGV[1]) then return 0 end
    return current
  `;
  const result = Number(await redis.eval(script, 1, key, String(limit), "120"));
  if (result === 0) {
    const retryAfter = 60 - new Date().getSeconds();
    throw new RelayLimitError("请求过于频繁，请稍后重试", "rate_limit_exceeded", retryAfter);
  }
}

async function acquireConcurrency(subject: string, limit: number): Promise<() => Promise<void>> {
  const key = `tokenhub:relay:concurrency:v2:${subject}`;
  const leaseId = randomUUID();
  // Attempts are sequential and each may consume the full upstream timeout.
  // Keep the concurrency slot alive for the entire retry budget.
  const ttlMs = env.RELAY_UPSTREAM_TIMEOUT_MS * env.RELAY_MAX_ATTEMPTS + 60_000;
  const acquireScript = `
    local redis_time = redis.call("TIME")
    local now_ms = redis_time[1] * 1000 + math.floor(redis_time[2] / 1000)
    redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now_ms)
    local current = redis.call("ZCARD", KEYS[1])
    if current >= tonumber(ARGV[1]) then return 0 end
    redis.call("ZADD", KEYS[1], now_ms + tonumber(ARGV[3]), ARGV[2])
    redis.call("PEXPIRE", KEYS[1], ARGV[3])
    return current + 1
  `;
  const result = Number(
    await redis.eval(acquireScript, 1, key, String(limit), leaseId, String(ttlMs)),
  );
  if (result === 0) {
    throw new RelayLimitError("并发请求数已达上限", "concurrency_limit_exceeded", 1);
  }

  let released = false;
  let releasePromise: Promise<void> | null = null;
  return async () => {
    if (released) return;
    if (!releasePromise) {
      releasePromise = (async () => {
        const releaseScript = `
          redis.call("ZREM", KEYS[1], ARGV[1])
          if redis.call("ZCARD", KEYS[1]) == 0 then
            redis.call("DEL", KEYS[1])
          end
          return 1
        `;
        await redis.eval(releaseScript, 1, key, leaseId);
        released = true;
      })();
    }

    try {
      await releasePromise;
    } catch (error) {
      // A transient Redis failure must remain retryable. The unique ZSET member
      // makes a retry idempotent even if Redis applied the first EVAL but the
      // client did not receive its response.
      releasePromise = null;
      throw error;
    }
  };
}

/** Tidal Keys only work while the feature is on and inside the daily window. */
async function assertTidalOpen(): Promise<void> {
  const settings = await loadTidalSettings();
  if (!settings.enabled) {
    throw new RelayLimitError("潮汐调度未开启，潮汐KEY 暂不可用", "tidal_disabled");
  }
  if (!isTidalWindowOpen(settings)) {
    throw new RelayLimitError(
      `潮汐KEY 仅在 ${tidalWindowLabel(settings)} 开放`,
      "tidal_window_closed",
    );
  }
}

export async function acquireRelayQuota(
  employeeId: number,
  teamId: number | null,
  /** The grant behind a tidal Key; such a Key is held to the grant's limits, not the employee's. */
  tidal?: (RelayTidalGrant & { apiKeyId: number }) | null,
): Promise<RelayQuotaLease> {
  assertTeamBound(teamId);
  if (tidal) await assertTidalOpen();

  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!team) {
    throw new RelayLimitError("API Key 未绑定团队，无法转发", "team_required");
  }

  await ensureRedisReady();
  if (tidal) {
    const subject = `tidal:${tidal.apiKeyId}`;
    await acquireRpm(subject, tidal.rpmLimit);
    return { release: await acquireConcurrency(subject, tidal.maxConcurrency) };
  }
  await acquireRpm(String(employeeId), env.RELAY_SAFEGUARD_RPM);
  const release = await acquireConcurrency(
    String(employeeId),
    env.RELAY_SAFEGUARD_MAX_CONCURRENCY,
  );

  return { release };
}
