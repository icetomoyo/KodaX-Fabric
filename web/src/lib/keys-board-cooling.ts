export type KeysBoardCoolingLane = "cooling_5h" | "cooling_weekly";

/** If remaining cool time is longer than this, treat unknown cooling as weekly. */
const WEEKLY_COOL_REMAINING_MS = 6 * 3_600_000;

const WEEKLY_CODES = new Set(["1310", "1317", "1319", "1321"]);
const FIVE_HOUR_CODES = new Set(["1308", "1316", "1318", "1320"]);

export function vendorCodeFromLastError(message: string): string | null {
  const bracket = /\[(\d{3,4})\]/.exec(message);
  if (bracket) return bracket[1];
  const bare = /\b(1308|1310|1316|1317|1318|1319|1320|1321)\b/.exec(message);
  return bare?.[1] ?? null;
}

function isWeeklyPhrase(message: string): boolean {
  return /7\s*[- ]?days?|7\s*天|周积分|每周/i.test(message);
}

function isFiveHourPhrase(message: string): boolean {
  return /5\s*[- ]?hours?|5\s*小时/i.test(message);
}

export function isShortRateLimitCooling(lastError: string | null | undefined): boolean {
  const message = lastError ?? "";
  if (!message) return false;
  if (isWeeklyPhrase(message) || isFiveHourPhrase(message)) return false;
  const code = vendorCodeFromLastError(message);
  if (code && (WEEKLY_CODES.has(code) || FIVE_HOUR_CODES.has(code))) return false;
  if (/使用上限|周积分|每周|余额不足|套餐已到期|套餐已失效|套餐暂未开放/.test(message)) return false;
  // 后四个短语来自 144 生产实测的智谱 429 原文（管理端「测试」路径存上游原文，无括号码）
  return /上游限流|速率限制|请求过于频繁|并发请求数已达上限|访问量过大|rate.?limit/i.test(message);
}

export function coolingLaneFromLastError(input: {
  lastError?: string | null;
  weeklyCreditLimit?: number | null;
  weeklyCredits?: number | null;
  coolUntil?: string | Date | null;
  now?: Date;
}): KeysBoardCoolingLane {
  const message = input.lastError ?? "";
  if (isWeeklyPhrase(message)) return "cooling_weekly";
  if (isFiveHourPhrase(message)) return "cooling_5h";
  const code = vendorCodeFromLastError(message);
  if (code && WEEKLY_CODES.has(code)) return "cooling_weekly";
  if (code && FIVE_HOUR_CODES.has(code)) return "cooling_5h";
  if (
    input.weeklyCreditLimit != null
    && Number.isFinite(input.weeklyCreditLimit)
    && input.weeklyCreditLimit > 0
    && (input.weeklyCredits ?? 0) >= input.weeklyCreditLimit * 0.95
  ) {
    return "cooling_weekly";
  }
  if (input.coolUntil) {
    const remaining = new Date(input.coolUntil).getTime() - (input.now ?? new Date()).getTime();
    if (Number.isFinite(remaining) && remaining > WEEKLY_COOL_REMAINING_MS) {
      return "cooling_weekly";
    }
  }
  return "cooling_5h";
}
