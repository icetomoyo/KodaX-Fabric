export const ZHIPU_TEAM_QUOTA_TIMEOUT_MS = 15_000;
const ZHIPU_TEAM_QUOTA_URL =
  "https://open.bigmodel.cn/api/monitor/usage/quota/limit?type=2";

const FIVE_HOUR_UNIT = 3;
const WEEKLY_UNIT = 6;

export type QuotaWindow = {
  used: number;
  limit: number;
  remaining: number;
  percentage: number;
  resetAt: string | null;
};

export type ZhipuTeamQuotaResult =
  | { ok: true; level: string; fiveHour: QuotaWindow | null; weekly: QuotaWindow | null }
  | { ok: false; message: string };

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
  const used = asFiniteNumber(row.currentValue);
  const limit = asFiniteNumber(row.usage);
  const remaining = asFiniteNumber(row.remaining);
  const percentage = asFiniteNumber(row.percentage);
  if (used == null || limit == null || remaining == null || percentage == null) {
    return null;
  }
  const resetMs = asFiniteNumber(row.nextResetTime);
  return {
    used,
    limit,
    remaining,
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
  for (const item of limits) {
    const row = asRecord(item);
    if (!row || row.type !== "CREDIT_LIMIT") continue;
    const unit = asFiniteNumber(row.unit);
    const window = parseQuotaWindow(row);
    if (unit === FIVE_HOUR_UNIT && fiveHour == null) fiveHour = window;
    else if (unit === WEEKLY_UNIT && weekly == null) weekly = window;
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
