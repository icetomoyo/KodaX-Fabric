import { and, eq, gt, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import { systemSettings, tidalGrants } from "../../db/schema/index.js";

/**
 * 潮汐调度的全局规则。被授权的员工用潮汐KEY 发请求，只在开放时段内可用，
 * 每次请求从闲置的渠道 Key 里挑一把（见 tidal-pool.ts）。
 */
export const TIDAL_SETTING_KEY = "tidal_scheduling";

export type TidalSettings = {
  enabled: boolean;
  /** 开放时段，QUOTA_TIMEZONE 下的 HH:mm；起止相同表示全天开放。 */
  windowStart: string;
  windowEnd: string;
  /** 周用量档位的分界（占周上限的比例，升序）：先用完低档位的 Key 再用高档位的。 */
  weeklyTiers: number[];
  /** 借用线：Key 的周用量 / 5 小时用量到了这个比例，潮汐就不再用它。 */
  weeklyLine: number;
  fiveHourLine: number;
  /** 一把渠道 Key 上最多几个潮汐在途请求。 */
  perKeyConcurrency: number;
};

export const DEFAULT_TIDAL_SETTINGS: TidalSettings = {
  enabled: false,
  windowStart: "22:00",
  windowEnd: "07:00",
  weeklyTiers: [0.05, 0.2],
  weeklyLine: 0.5,
  fiveHourLine: 0.6,
  perKeyConcurrency: 2,
};

const clockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "时间格式应为 HH:mm");
const ratioSchema = z.number().gt(0).lte(1);

export const tidalSettingsSchema = z.object({
  enabled: z.boolean(),
  windowStart: clockSchema,
  windowEnd: clockSchema,
  weeklyTiers: z
    .array(z.number().gt(0).lt(1))
    .min(1)
    .max(4)
    .refine(
      (tiers) => tiers.every((tier, index) => index === 0 || tier > tiers[index - 1]),
      "档位分界必须从小到大",
    ),
  weeklyLine: ratioSchema,
  fiveHourLine: ratioSchema,
  perKeyConcurrency: z.number().int().min(1).max(20),
});

function parseTidalSettings(value: unknown): TidalSettings {
  const parsed = tidalSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_TIDAL_SETTINGS;
}

let cached: { settings: TidalSettings; at: number } | null = null;

export async function loadTidalSettings(): Promise<TidalSettings> {
  const nowMs = Date.now();
  if (cached && nowMs - cached.at < env.RELAY_TIDAL_SNAPSHOT_TTL_MS) return cached.settings;
  const [row] = await db
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, TIDAL_SETTING_KEY))
    .limit(1);
  const settings = parseTidalSettings(row?.value);
  cached = { settings, at: nowMs };
  return settings;
}

export async function saveTidalSettings(next: TidalSettings): Promise<TidalSettings> {
  const now = new Date();
  await db
    .insert(systemSettings)
    .values({ key: TIDAL_SETTING_KEY, value: next, updatedAt: now })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: next, updatedAt: now },
    });
  cached = { settings: next, at: Date.now() };
  return next;
}

function minuteOfDay(clock: string): number {
  const [hour, minute] = clock.split(":").map(Number);
  return hour * 60 + minute;
}

function zonedMinuteOfDay(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return (value("hour") % 24) * 60 + value("minute");
}

/** Whether `now` falls inside the daily window; a window may wrap past midnight. */
export function isTidalWindowOpen(
  settings: Pick<TidalSettings, "windowStart" | "windowEnd">,
  now: Date = new Date(),
  timeZone: string = env.QUOTA_TIMEZONE,
): boolean {
  const start = minuteOfDay(settings.windowStart);
  const end = minuteOfDay(settings.windowEnd);
  if (start === end) return true;
  const current = zonedMinuteOfDay(now, timeZone);
  return start < end ? current >= start && current < end : current >= start || current < end;
}

export function tidalWindowLabel(
  settings: Pick<TidalSettings, "windowStart" | "windowEnd">,
  timeZone: string = env.QUOTA_TIMEZONE,
): string {
  if (settings.windowStart === settings.windowEnd) return "全天";
  return `${settings.windowStart}–${settings.windowEnd}（${timeZone}）`;
}

export type ActiveTidalGrant = {
  id: number;
  maxConcurrency: number;
  rpmLimit: number;
  expiresAt: Date | null;
};

type GrantReader = Pick<typeof db, "select">;

/** The employee's grant, when it exists and has not expired. */
export async function findActiveTidalGrant(
  employeeId: number,
  now: Date = new Date(),
  executor: GrantReader = db,
): Promise<ActiveTidalGrant | null> {
  const [row] = await executor
    .select({
      id: tidalGrants.id,
      maxConcurrency: tidalGrants.maxConcurrency,
      rpmLimit: tidalGrants.rpmLimit,
      expiresAt: tidalGrants.expiresAt,
    })
    .from(tidalGrants)
    .where(
      and(
        eq(tidalGrants.employeeId, employeeId),
        or(isNull(tidalGrants.expiresAt), gt(tidalGrants.expiresAt, now)),
      ),
    )
    .limit(1);
  return row ?? null;
}
