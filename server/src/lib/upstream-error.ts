/**
 * Generic upstream JSON-envelope parsers. Vendor-specific codes live in
 * channel plugins (`classifyError`); this module only reads structure.
 */

export type UpstreamRateLimitDisposition =
  | "fair_use"
  | "plan_expired"
  | "model_busy"
  | "model_not_in_plan"
  | "key_limited";

export type UpstreamUsageCapKind = "five_hour" | "weekly" | "monthly" | "other";

export type UpstreamUsageCap = {
  kind: UpstreamUsageCapKind;
  /** Reset instant parsed from the upstream message (Asia/Shanghai wall time), if present. */
  resetAt: Date | null;
};

export function normalizeErrorCode(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 64) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 4000) : null;
}

const USAGE_CAP_RESET_TIME = /(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/;

/** 智谱、火山方舟的额度重置时刻都是 Asia/Shanghai 墙上时间。 */
export function parseUsageCapResetAt(message: string): Date | null {
  const match = USAGE_CAP_RESET_TIME.exec(message);
  if (!match) return null;
  const parsed = new Date(`${match[1]}T${match[2]}+08:00`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/** 从上游响应信封取出原文业务码和错误信息，不改写。 */
export function extractUpstreamBusinessError(payload: unknown): { code: string | null; message: string | null } | null {
  let value = payload;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return { code: null, message: trimmed.slice(0, 4000) };
    }
    try {
      value = JSON.parse(trimmed);
    } catch {
      return { code: null, message: trimmed.slice(0, 4000) };
    }
  }
  if (!isRecord(value)) return null;
  const error = isRecord(value.error) ? value.error : value;
  const nestedType = normalizeErrorCode(error.type);
  const code = normalizeErrorCode(error.code)
    ?? (nestedType && nestedType !== "error" ? nestedType : null);
  const message = asMessage(error.message);
  if (!code && !message) return null;
  return { code, message };
}

/** Hub 冷却文案之外，健康检查展示渠道原文。 */
export function formatUpstreamVendorError(
  status: number | null,
  raw: string | null,
): string {
  const text = raw?.trim() ?? "";
  if (!text) return status != null ? `HTTP ${status}` : "上游错误";
  const extracted = extractUpstreamBusinessError(text);
  if (extracted?.message) {
    return extracted.code ? `[${extracted.code}] ${extracted.message}` : extracted.message;
  }
  return text.slice(0, 1_000);
}

export function resolveLoggedError(input: {
  httpStatus?: number | null;
  upstreamStatus?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  upstreamPayload?: unknown;
}): { code: string | null; httpStatus: number | null; message: string | null } {
  const extracted = extractUpstreamBusinessError(input.upstreamPayload);
  return {
    code: extracted?.code ?? normalizeErrorCode(input.errorCode),
    httpStatus: input.upstreamStatus ?? input.httpStatus ?? null,
    message: extracted?.message ?? asMessage(input.errorMessage),
  };
}
