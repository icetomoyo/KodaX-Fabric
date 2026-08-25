import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import {
  enterprises,
  modelPrices,
  requestAudits,
  teamMembers,
  teams,
  usageCountersTeamDaily,
} from "../../db/schema/index.js";
import { packageMonthlyYuan, yuanToCents } from "../enterprise-package.js";
import { sumRequestCostYuanSql } from "../model-cost.js";
import { quotaDayAt, zonedMonthRange } from "../quota-time.js";
import { redis } from "../../redis.js";

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
  "enterprise_quota_not_assigned",
  "team_required",
  "team_quota_not_assigned",
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

export function assertEnterprisePackageAssigned(monthlyYuan: number): void {
  if (monthlyYuan <= 0) {
    throw new RelayLimitError("企业尚未获得套餐，无法转发", "enterprise_quota_not_assigned");
  }
}

export function assertTeamQuotaAssigned(monthlyYuan: number): void {
  if (monthlyYuan <= 0) {
    throw new RelayLimitError("团队尚未分配每月额度，无法转发", "team_quota_not_assigned");
  }
}

export function assertTeamQuotaNotExceeded(usedYuan: number, monthlyYuan: number): void {
  if (yuanToCents(usedYuan) >= yuanToCents(monthlyYuan)) {
    throw new RelayLimitError("团队本月套餐额度已用尽", "team_quota_exceeded");
  }
}

export function assertMemberLimitNotExceeded(
  usedTokens: number,
  dailyTokenLimit: number | null | undefined,
): void {
  if (dailyTokenLimit == null) return;
  if (usedTokens >= dailyTokenLimit) {
    throw new RelayLimitError("今日个人 Token 上限已用尽", "member_limit_exceeded");
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

export async function acquireRelayQuota(
  employeeId: number,
  teamId: number | null,
): Promise<RelayQuotaLease> {
  assertTeamBound(teamId);

  const now = new Date();
  const quotaDay = quotaDayAt(now, env.QUOTA_TIMEZONE);
  const month = zonedMonthRange(now, env.QUOTA_TIMEZONE);
  const monthStartAt = month.start.toISOString();
  const monthEndAt = month.endExclusive.toISOString();
  const [team] = await db
    .select({
      id: teams.id,
      monthlyYuanQuota: teams.monthlyYuanQuota,
      packagePlan: enterprises.packagePlan,
    })
    .from(teams)
    .innerJoin(enterprises, eq(teams.enterpriseId, enterprises.id))
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!team) {
    throw new RelayLimitError("API Key 未绑定团队，无法转发", "team_required");
  }

  const packageYuan = packageMonthlyYuan(team.packagePlan);
  const teamYuan = Number(team.monthlyYuanQuota);
  assertEnterprisePackageAssigned(packageYuan);
  assertTeamQuotaAssigned(teamYuan);

  const [[teamUsed], [member], [memberUsed]] = await Promise.all([
    db
      .select({
        costYuan: sumRequestCostYuanSql,
      })
      .from(requestAudits)
      .leftJoin(modelPrices, eq(modelPrices.model, requestAudits.clientModel))
      .where(
        and(
          eq(requestAudits.teamId, teamId),
          sql`${requestAudits.createdAt} >= ${monthStartAt}::timestamptz`,
          sql`${requestAudits.createdAt} < ${monthEndAt}::timestamptz`,
        ),
      ),
    db
      .select({ dailyTokenLimit: teamMembers.dailyTokenLimit })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.employeeId, employeeId)))
      .limit(1),
    db
      .select({ totalTokens: usageCountersTeamDaily.totalTokens })
      .from(usageCountersTeamDaily)
      .where(
        and(
          eq(usageCountersTeamDaily.teamId, teamId),
          eq(usageCountersTeamDaily.employeeId, employeeId),
          eq(usageCountersTeamDaily.day, quotaDay),
        ),
      )
      .limit(1),
  ]);

  assertTeamQuotaNotExceeded(Number(teamUsed?.costYuan ?? 0), teamYuan);
  assertMemberLimitNotExceeded(memberUsed?.totalTokens ?? 0, member?.dailyTokenLimit);

  await ensureRedisReady();
  await acquireRpm(employeeId, env.RELAY_SAFEGUARD_RPM);
  const release = await acquireConcurrency(employeeId, env.RELAY_SAFEGUARD_MAX_CONCURRENCY);

  return { release };
}
