export const ZHIPU_TEAM_QUOTA_TIMEOUT_MS = 15_000;
const ZHIPU_TEAM_QUOTA_URL =
  "https://open.bigmodel.cn/api/monitor/usage/quota/limit?type=2";

const FIVE_HOUR_UNIT = 3;
const WEEKLY_UNIT = 6;

/**
 * 积分套餐（CREDIT_LIMIT）给出已用量 / 上限 / 剩余；Token 套餐（TOKENS_LIMIT）只给百分比，
 * 这三项为 null。窗口还没开始时没有 nextResetTime。
 */
export type QuotaWindow = {
  used: number | null;
  limit: number | null;
  remaining: number | null;
  percentage: number;
  resetAt: string | null;
};

export type ZhipuTeamQuotaResult =
  | { ok: true; level: string; fiveHour: QuotaWindow | null; weekly: QuotaWindow | null }
  | { ok: false; message: string };

/** TIME_LIMIT 是联网搜索等工具的调用次数，不是额度窗口。 */
const QUOTA_LIMIT_TYPES = ["CREDIT_LIMIT", "TOKENS_LIMIT"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

function parseQuotaWindow(row: Record<string, unknown>): QuotaWindow | null {
  const percentage = asFiniteNumber(row.percentage);
  if (percentage == null) return null;
  const resetMs = asFiniteNumber(row.nextResetTime);
  return {
    used: asFiniteNumber(row.currentValue),
    limit: asFiniteNumber(row.usage),
    remaining: asFiniteNumber(row.remaining),
    percentage,
    resetAt: resetMs == null ? null : new Date(resetMs).toISOString(),
  };
}

function parseWindows(limits: unknown): {
  fiveHour: QuotaWindow | null;
  weekly: QuotaWindow | null;
} {
  let fiveHour: QuotaWindow | null = null;
  let weekly: QuotaWindow | null = null;
  if (!Array.isArray(limits)) return { fiveHour, weekly };
  const rows = limits.map(asRecord).filter((row): row is Record<string, unknown> => row != null);
  // 两种都有时以 CREDIT_LIMIT 为准，它带具体积分。
  for (const type of QUOTA_LIMIT_TYPES) {
    for (const row of rows) {
      if (row.type !== type) continue;
      const unit = asFiniteNumber(row.unit);
      if (unit === FIVE_HOUR_UNIT && fiveHour == null) fiveHour = parseQuotaWindow(row);
      else if (unit === WEEKLY_UNIT && weekly == null) weekly = parseQuotaWindow(row);
    }
  }
  return { fiveHour, weekly };
}

function parseJsonUnknown(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function failureMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") return "请求超时";
  }
  return "网络错误";
}

export async function fetchZhipuTeamQuota(input: {
  apiKey: string;
  organizationId: string;
  projectId: string;
  signal?: AbortSignal;
}): Promise<ZhipuTeamQuotaResult> {
  const timeoutSignal = AbortSignal.timeout(ZHIPU_TEAM_QUOTA_TIMEOUT_MS);
  const signal = input.signal
    ? AbortSignal.any([input.signal, timeoutSignal])
    : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(ZHIPU_TEAM_QUOTA_URL, {
      method: "GET",
      headers: {
        Authorization: input.apiKey,
        "bigmodel-organization": input.organizationId,
        "bigmodel-project": input.projectId,
        "Content-Type": "application/json",
        "Accept-Language": "en-US,en",
      },
      signal,
    });
  } catch (error) {
    return { ok: false, message: failureMessage(error) };
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, message: "凭据无效" };
  }
  if (!response.ok) {
    return { ok: false, message: `HTTP ${response.status}` };
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return { ok: false, message: failureMessage(error) };
  }

  const payload = asRecord(parseJsonUnknown(text));
  if (!payload) {
    return { ok: false, message: "响应无效" };
  }
  if (payload.success === false) {
    return { ok: false, message: asTrimmedString(payload.msg) ?? "查询失败" };
  }

  const data = asRecord(payload.data);
  if (!data) {
    return { ok: false, message: "响应无效" };
  }
  const windows = parseWindows(data.limits);
  return {
    ok: true,
    level: asTrimmedString(data.level) ?? "",
    fiveHour: windows.fiveHour,
    weekly: windows.weekly,
  };
}
