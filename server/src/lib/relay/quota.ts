import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import {
  employees,
  quotaPolicy,
  usageCountersDaily,
} from "../../db/schema/index.js";
import { membershipDailyTokenLimit } from "../enterprise.js";
import { quotaDayAt } from "../quota-time.js";
import { redis } from "../../redis.js";

export type EffectiveRelayQuota = {
  dailyTokenLimit: number;
  rpm: number;
  maxConcurrency: number;
  enterpriseId: number | null;
};

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

export function assertDailyTokenLimit(totalTokens: number, dailyTokenLimit: number): void {
  if (totalTokens >= dailyTokenLimit) {
    throw new RelayLimitError("今日 Token 配额已用尽", "daily_token_limit_exceeded");
  }
}

export async function getEffectiveRelayQuota(employeeId: number): Promise<EffectiveRelayQuota> {
  const [policy] = await db
    .select({ dailyTokenLimit: quotaPolicy.dailyTokenLimit })
    .from(quotaPolicy)
    .where(eq(quotaPolicy.key, "default"))
    .limit(1);
  if (policy?.dailyTokenLimit === null || policy?.dailyTokenLimit === undefined) {
    throw new Error("默认日 Token 配额未初始化，请先执行 v0.0.3 数据库迁移");
  }

  const [employee] = await db
    .select({ enterpriseId: employees.enterpriseId })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);

  return {
    dailyTokenLimit: membershipDailyTokenLimit(employee?.enterpriseId, policy.dailyTokenLimit),
    rpm: env.RELAY_SAFEGUARD_RPM,
    maxConcurrency: env.RELAY_SAFEGUARD_MAX_CONCURRENCY,
    enterpriseId: employee?.enterpriseId ?? null,
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

export async function acquireRelayQuota(employeeId: number): Promise<RelayQuotaLease> {
  const effective = await getEffectiveRelayQuota(employeeId);
  const quotaDay = quotaDayAt(new Date(), env.QUOTA_TIMEZONE);
  const [daily] = await db
    .select({
      totalTokens: usageCountersDaily.totalTokens,
    })
    .from(usageCountersDaily)
    .where(
      and(
        eq(usageCountersDaily.employeeId, employeeId),
        eq(usageCountersDaily.day, quotaDay),
      ),
    )
    .limit(1);

  const totalTokens = daily?.totalTokens ?? 0;

  if (effective.enterpriseId == null) {
    throw new RelayLimitError("未加入企业，暂无 Token 额度", "enterprise_required");
  }

  assertDailyTokenLimit(totalTokens, effective.dailyTokenLimit);

  await ensureRedisReady();
  await acquireRpm(employeeId, effective.rpm);
  const release = await acquireConcurrency(employeeId, effective.maxConcurrency);

  return { release };
}
