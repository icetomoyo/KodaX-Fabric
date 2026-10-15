import type { QuotaWindow } from "./zhipu-team-quota.js";

/**
 * 按官方额度快照校正渠道 Key 的冷却状态。官方快照是刷新那一刻的真实额度，
 * 比 relay 记下的冷却（来自更早的一次 429）新：
 * - 某个窗口官方已用到 100% 且重置时刻未到 → 冷却到官方给的重置时刻（周额度优先）。
 * - Key 正因额度用尽（five_hour_cap / weekly_cap）冷却，官方却说两个窗口都没满
 *   （比如上游窗口已经重置）→ 解除冷却。
 * 停用的 Key、短时限流等其他原因的冷却不在这里处理。
 */
export type QuotaCapKind = "five_hour_cap" | "weekly_cap";

export const QUOTA_CAP_KINDS: readonly QuotaCapKind[] = ["five_hour_cap", "weekly_cap"];

export type OfficialCoolingTarget =
  | { action: "cool"; kind: QuotaCapKind; until: Date }
  | { action: "release" }
  | { action: "keep" };

function fullUntil(window: QuotaWindow | null | undefined, now: Date): Date | null {
  if (!window || !(window.percentage >= 100) || !window.resetAt) return null;
  const until = new Date(window.resetAt);
  return until.getTime() > now.getTime() ? until : null;
}

export function officialCoolingTarget(input: {
  status: string;
  coolUntil: Date | null;
  lastFailureKind: string | null;
  fiveHour: QuotaWindow | null | undefined;
  weekly: QuotaWindow | null | undefined;
  now: Date;
}): OfficialCoolingTarget {
  if (input.status !== "active" && input.status !== "cooling") return { action: "keep" };
  const weeklyUntil = fullUntil(input.weekly, input.now);
  if (weeklyUntil) return { action: "cool", kind: "weekly_cap", until: weeklyUntil };
  const fiveHourUntil = fullUntil(input.fiveHour, input.now);
  if (fiveHourUntil) return { action: "cool", kind: "five_hour_cap", until: fiveHourUntil };

  const coolingForQuota = input.coolUntil != null
    && input.coolUntil.getTime() > input.now.getTime()
    && QUOTA_CAP_KINDS.includes(input.lastFailureKind as QuotaCapKind);
  // 只有官方两个窗口都给了数、都没满，才敢解除额度冷却。
  if (coolingForQuota && input.fiveHour && input.weekly) return { action: "release" };
  return { action: "keep" };
}
