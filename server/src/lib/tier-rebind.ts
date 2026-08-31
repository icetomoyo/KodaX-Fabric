/**
 * Daily usage-tier rebind job.
 *
 * Recalculates `employees.usageTier` from the last 7 calendar days' peak
 * `usage_counters_daily.totalTokens` (same window as the admin key-bindings
 * view). A tier change does not rewrite existing binding rows: request-time
 * scope resolution naturally lands on the new exclusive / team / enterprise
 * scope and creates bindings on demand. `releaseOrphanBindings` then drops
 * bindings whose scope subject no longer applies.
 */
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { env } from "../config.js";
import { db } from "../db/client.js";
import { employees, usageCountersDaily } from "../db/schema/index.js";
import { addCalendarDays, quotaDayAt } from "./quota-time.js";
import { releaseOrphanBindings } from "./relay/binding.js";
import { classifyUsageTier, USAGE_TIERS, type UsageTier } from "./usage-tier.js";

export type TierRebindResult = {
  employeeCount: number;
  changedCount: number;
  orphanReleased: number;
};

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

function emptyIdsByTier(): Record<UsageTier, number[]> {
  return { light: [], standard: [], heavy: [] };
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
      })
      .from(employees)
      .where(eq(employees.status, "active")),
    db
      .select({
        employeeId: usageCountersDaily.employeeId,
        peakTokens: sql<number>`max(${usageCountersDaily.totalTokens})`,
      })
      .from(usageCountersDaily)
      .where(and(gte(usageCountersDaily.day, usageFrom), lte(usageCountersDaily.day, today)))
      .groupBy(usageCountersDaily.employeeId),
  ]);

  const peakByEmployee = new Map(
    usageRows.map((row) => [row.employeeId, Number(row.peakTokens) || 0]),
  );

  const idsByNextTier = emptyIdsByTier();
  for (const row of activeRows) {
    const next = classifyUsageTier(peakByEmployee.get(row.id) ?? null);
    if (next !== row.usageTier) {
      idsByNextTier[next].push(row.id);
    }
  }

  let changedCount = 0;
  for (const tier of USAGE_TIERS) {
    const ids = idsByNextTier[tier];
    if (ids.length === 0) continue;
    await db.update(employees).set({ usageTier: tier }).where(inArray(employees.id, ids));
    changedCount += ids.length;
  }

  const orphanReleased = await releaseOrphanBindings(now);
  const result: TierRebindResult = {
    employeeCount: activeRows.length,
    changedCount,
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
