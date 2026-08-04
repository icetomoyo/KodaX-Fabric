import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import {
  employeeQuotaOverrides,
  quotaPolicies,
  usageCountersDaily,
} from "../../db/schema/index.js";
import { redis } from "../../redis.js";

export type EffectiveRelayQuota = {
  softTpmDay: number | null;
  hardTpmDay: number | null;
  rpm: number;
  maxConcurrency: number;
  softReqDay: number | null;
  hardReqDay: number | null;
};

export type RelayQuotaLease = {
  effective: EffectiveRelayQuota;
  softLimitHit: boolean;
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

const DEFAULT_QUOTA: EffectiveRelayQuota = {
  softTpmDay: 2_000_000,
  hardTpmDay: null,
  rpm: 60,
  maxConcurrency: 5,
  softReqDay: 2_000,
  hardReqDay: null,
};

export async function getEffectiveRelayQuota(employeeId: number): Promise<EffectiveRelayQuota> {
  const [override] = await db
    .select()
    .from(employeeQuotaOverrides)
    .where(eq(employeeQuotaOverrides.employeeId, employeeId))
    .limit(1);

  let policy: typeof quotaPolicies.$inferSelect | undefined;
  if (override?.policyId) {
    [policy] = await db
      .select()
      .from(quotaPolicies)
      .where(eq(quotaPolicies.id, override.policyId))
      .limit(1);
  }
  if (!policy) {
    [policy] = await db
      .select()
      .from(quotaPolicies)
      .where(eq(quotaPolicies.isDefault, true))
      .limit(1);
  }

  const base = policy ?? DEFAULT_QUOTA;
  return {
    softTpmDay: override?.softTpmDay ?? base.softTpmDay,
    hardTpmDay: override?.hardTpmDay ?? base.hardTpmDay,
    rpm: override?.rpm ?? base.rpm,
    maxConcurrency: override?.maxConcurrency ?? base.maxConcurrency,
    softReqDay: base.softReqDay,
    hardReqDay: base.hardReqDay,
  };
}

async function ensureRedisReady() {
  if (redis.status === "ready") return;
  // Sending a command is safe while ioredis is connecting/reconnecting: it is
  // queued until the connection is ready. Calling connect() here can race with
  // another request and throw "already connecting".
  const pong = await redis.ping();
  if (pong !== "PONG") throw new Error("Redis PING failed");
}

async function acquireRpm(employeeId: number, limit: number) {
  const minute = Math.floor(Date.now() / 60_000);
  const key = `tokenhub:relay:rpm:${employeeId}:${minute}`;
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

async function acquireConcurrency(employeeId: number, limit: number): Promise<() => Promise<void>> {
  const key = `tokenhub:relay:concurrency:v2:${employeeId}`;
  const leaseId = randomUUID();
  const ttlMs = env.RELAY_UPSTREAM_TIMEOUT_MS + 60_000;
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

export async function acquireRelayQuota(employeeId: number): Promise<RelayQuotaLease> {
  const effective = await getEffectiveRelayQuota(employeeId);
  const [daily] = await db
    .select({
      totalTokens: usageCountersDaily.totalTokens,
      requestCount: usageCountersDaily.requestCount,
    })
    .from(usageCountersDaily)
    .where(
      and(
        eq(usageCountersDaily.employeeId, employeeId),
        sql`${usageCountersDaily.day} = current_date`,
      ),
    )
    .limit(1);

  const totalTokens = daily?.totalTokens ?? 0;
  const requestCount = daily?.requestCount ?? 0;

  if (effective.hardTpmDay !== null && totalTokens >= effective.hardTpmDay) {
    throw new RelayLimitError("今日 Token 配额已用尽", "daily_token_limit_exceeded");
  }
  if (effective.hardReqDay !== null && requestCount >= effective.hardReqDay) {
    throw new RelayLimitError("今日请求配额已用尽", "daily_request_limit_exceeded");
  }

  const softLimitHit =
    (effective.softTpmDay !== null && totalTokens >= effective.softTpmDay) ||
    (effective.softReqDay !== null && requestCount >= effective.softReqDay);

  await ensureRedisReady();
  await acquireRpm(employeeId, effective.rpm);
  const release = await acquireConcurrency(employeeId, effective.maxConcurrency);

  return { effective, softLimitHit, release };
}
