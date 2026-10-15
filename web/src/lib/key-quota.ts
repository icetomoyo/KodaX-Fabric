/**
 * 渠道 Key 各额度窗口的使用率。Key 看板的圆环和 KEYS 表格共用这一套取数规则，
 * 可信度从高到低：
 * 1. 上游刚回了这个窗口用尽（Key 正为此冷却）→ 100%。
 * 2. KEYS 表格「刷新」到的官方快照还在当前窗口内 → 官方百分比。
 * 3. 本地账本（本地积分 ÷ 套餐上限）。
 */
export type QuotaWindowKind = "five" | "weekly" | "monthly";

export type QuotaWindowSource = "upstream_cap" | "official" | "local";

export type OfficialQuotaWindow = {
  percentage: number;
  resetAt: string | null;
};

export type KeyQuotaRow = {
  status: string;
  coolUntil: string | null;
  lastFailureKind: string | null;
  fiveHourCredits: number;
  weeklyCredits: number;
  monthlyCredits?: number;
  fiveHourCreditLimit: number | null;
  weeklyCreditLimit: number | null;
  monthlyCreditLimit?: number | null;
  nextFiveHourResetAt: string | null;
  nextWeeklyResetAt: string | null;
  nextMonthlyResetAt?: string | null;
  weeklyResetEstimated?: boolean;
  /** KEYS 表格「刷新」写入的官方额度快照。 */
  officialQuota?: {
    state?: string;
    message?: string;
    fiveHour?: OfficialQuotaWindow | null;
    weekly?: OfficialQuotaWindow | null;
    monthly?: OfficialQuotaWindow | null;
  } | null;
  officialQuotaAt?: string | null;
};

const CAP_KIND: Record<QuotaWindowKind, string> = {
  five: "five_hour_cap",
  weekly: "weekly_cap",
  monthly: "monthly_cap",
};

function coolingNow(row: KeyQuotaRow, now: number): boolean {
  if (row.status !== "active" && row.status !== "cooling") return false;
  if (!row.coolUntil) return false;
  const until = new Date(row.coolUntil).getTime();
  return Number.isFinite(until) && until > now;
}

export function upstreamWindowExhausted(
  row: KeyQuotaRow,
  kind: QuotaWindowKind,
  now = Date.now(),
): boolean {
  return coolingNow(row, now) && row.lastFailureKind === CAP_KIND[kind];
}

/** 官方快照里这个窗口还没翻页（重置时刻未到）才算数；窗口没开始时没有重置时刻。 */
export function currentOfficialWindow(
  row: KeyQuotaRow,
  kind: QuotaWindowKind,
  now = Date.now(),
): OfficialQuotaWindow | null {
  const quota = row.officialQuota;
  if (!quota || quota.state !== "ok") return null;
  const window = kind === "five" ? quota.fiveHour : kind === "weekly" ? quota.weekly : quota.monthly;
  if (!window || !Number.isFinite(window.percentage)) return null;
  if (window.resetAt && new Date(window.resetAt).getTime() <= now) return null;
  return window;
}

export function windowLimit(row: KeyQuotaRow, kind: QuotaWindowKind): number | null {
  if (kind === "five") return row.fiveHourCreditLimit;
  if (kind === "weekly") return row.weeklyCreditLimit;
  return row.monthlyCreditLimit ?? null;
}

export function windowCredits(row: KeyQuotaRow, kind: QuotaWindowKind): number {
  if (kind === "five") return row.fiveHourCredits;
  if (kind === "weekly") return row.weeklyCredits;
  return row.monthlyCredits ?? 0;
}

function localPercent(row: KeyQuotaRow, kind: QuotaWindowKind): number {
  const limit = windowLimit(row, kind);
  const used = windowCredits(row, kind);
  if (limit == null || !(limit > 0) || !Number.isFinite(used)) return 0;
  return Math.min(100, Math.round((used / limit) * 1000) / 10);
}

/** 这个窗口的使用率从哪来；没有上限、没有快照、上游也没说用尽时为 null（不限）。 */
export function windowSource(
  row: KeyQuotaRow,
  kind: QuotaWindowKind,
  now = Date.now(),
): QuotaWindowSource | null {
  if (upstreamWindowExhausted(row, kind, now)) return "upstream_cap";
  if (currentOfficialWindow(row, kind, now)) return "official";
  return windowLimit(row, kind) != null ? "local" : null;
}

export function windowTracked(row: KeyQuotaRow, kind: QuotaWindowKind, now = Date.now()): boolean {
  return windowSource(row, kind, now) != null;
}

export function windowPercent(row: KeyQuotaRow, kind: QuotaWindowKind, now = Date.now()): number {
  const source = windowSource(row, kind, now);
  if (source === "upstream_cap") return 100;
  if (source === "official") {
    return Math.min(100, Math.max(0, currentOfficialWindow(row, kind, now)!.percentage));
  }
  return localPercent(row, kind);
}

/** 重置时刻：官方快照给了就用官方的，否则用本地推算。 */
export function windowResetAt(row: KeyQuotaRow, kind: QuotaWindowKind, now = Date.now()): string | null {
  const official = currentOfficialWindow(row, kind, now)?.resetAt;
  if (official) return official;
  if (kind === "five") return row.nextFiveHourResetAt;
  if (kind === "weekly") return row.nextWeeklyResetAt;
  return row.nextMonthlyResetAt ?? null;
}

export function weeklyResetEstimated(row: KeyQuotaRow, now = Date.now()): boolean {
  return !currentOfficialWindow(row, "weekly", now)?.resetAt && Boolean(row.weeklyResetEstimated);
}
