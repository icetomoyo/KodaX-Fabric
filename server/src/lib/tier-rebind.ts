/**
 * Daily usage-tier rebind job.
 *
 * Recalculates `employees.usageTier`: 7×24h after registration stays 重度;
 * after that, the last 7 calendar days' average daily tokens and call count
 * (same window as request-time binding). Idle (0 TokenHub calls) holds no
 * Key. After a tier change, rebound each employee onto the Key their new
 * scope needs (heavy exclusive → standard department share) and drop
 * bindings nobody still needs.
 */
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { env } from "../config.js";
import { db } from "../db/client.js";
import { employees, usageCountersDaily } from "../db/schema/index.js";
import { addCalendarDays, quotaDayAt } from "./quota-time.js";
import {
  rebindEmployeesToCurrentScope,
  releaseOrphanBindings,
} from "./relay/binding.js";
import {
  averageDailyTokensFromWindow,
  effectiveUsageTier,
  USAGE_TIERS,
  type UsageTier,
} from "./usage-tier.js";

export type TierRebindResult = {
  employeeCount: number;
  changedCount: number;
  reboundCount: number;
  orphanReleased: number;
};

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

function emptyIdsByTier(): Record<UsageTier, number[]> {
  return { idle: [], standard: [], heavy: [] };
}

export async function runTierRebindOnce(
  logger: FastifyBaseLogger,
  now: Date = new Date(),
): Promise<TierRebindResult> {
  const today = quotaDayAt(now, env.QUOTA_TIMEZONE);
  const usageFrom = addCalendarDays(today, -6);

  const [activeRows, usageRows] = await Promise.all([
    db
      .select({
        id: employees.id,
        usageTier: employees.usageTier,
        createdAt: employees.createdAt,
      })
      .from(employees)
      .where(eq(employees.status, "active")),
    db
      .select({
        employeeId: usageCountersDaily.employeeId,
        totalTokens: sql<number>`coalesce(sum(${usageCountersDaily.totalTokens}), 0)`,
        requestCount: sql<number>`coalesce(sum(${usageCountersDaily.requestCount}), 0)`,
      })
      .from(usageCountersDaily)
      .where(and(gte(usageCountersDaily.day, usageFrom), lte(usageCountersDaily.day, today)))
      .groupBy(usageCountersDaily.employeeId),
  ]);

  const averageByEmployee = new Map(
    usageRows.map((row) => [row.employeeId, averageDailyTokensFromWindow(Number(row.totalTokens) || 0)]),
  );
  const requestsByEmployee = new Map(
    usageRows.map((row) => [row.employeeId, Number(row.requestCount) || 0]),
  );

  const idsByNextTier = emptyIdsByTier();
  for (const row of activeRows) {
    const next = effectiveUsageTier(
      averageByEmployee.get(row.id) ?? null,
      row.createdAt,
      now,
      requestsByEmployee.get(row.id) ?? 0,
    );
    if (next !== row.usageTier) {
      idsByNextTier[next].push(row.id);
    }
  }

  let changedCount = 0;
  const changedIds: number[] = [];
  for (const tier of USAGE_TIERS) {
    const ids = idsByNextTier[tier];
    if (ids.length === 0) continue;
    await db.update(employees).set({ usageTier: tier, updatedAt: now }).where(inArray(employees.id, ids));
    changedCount += ids.length;
    changedIds.push(...ids);
  }

  const reboundIds = changedIds.filter((id) => !idsByNextTier.idle.includes(id));
  const reboundCount = await rebindEmployeesToCurrentScope(reboundIds, now);
  const orphanReleased = await releaseOrphanBindings(now);
  const result: TierRebindResult = {
    employeeCount: activeRows.length,
    changedCount,
    reboundCount,
    orphanReleased,
  };
  logger.info(result, "tier rebind completed");
  return result;
}

async function tick(logger: FastifyBaseLogger): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    await runTierRebindOnce(logger);
  } catch (err) {
    logger.error({ err }, "tier rebind failed");
  } finally {
    inFlight = false;
  }
}

export function startTierRebind(logger: FastifyBaseLogger): void {
  if (timer) return;

  const intervalMs = env.TIER_REBIND_INTERVAL_SECONDS * 1_000;
  void tick(logger);
  timer = setInterval(() => {
    void tick(logger);
  }, intervalMs);
  timer.unref?.();
  process.once("exit", stopTierRebind);
}

export function stopTierRebind(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  inFlight = false;
}
