/**
 * 智谱错误码。以 https://docs.bigmodel.cn/cn/faq/api-code 为底；
 * coding-plan 线上与文档不一致的条目（1308 / 1310）按实测原文对齐。
 * 1316 / 1317 仍是文档里「主账号余额不足、无法超额按量」的变体：
 * 推理打满 5 小时 / 7 天走的是 1308 / 1310，不是这两码。
 */
export type GlmErrorCatalogEntry = {
  code: string | null;
  httpStatus: number;
  message: string;
};

/** 占位符（${field} 等）保持文档写法；1308 / 1310 为线上原文。 */
export const GLM_ERROR_CATALOG: readonly GlmErrorCatalogEntry[] = [
  { code: null, httpStatus: 500, message: "内部错误" },
  { code: "1000", httpStatus: 401, message: "身份验证失败" },
  { code: "1001", httpStatus: 401, message: "Header 中未收到 Authentication 参数，无法进行身份验证" },
  { code: "1003", httpStatus: 401, message: "Authentication Token 已过期，请重新生成/获取" },
  { code: "1005", httpStatus: 401, message: "已开启二次认证保护，需要二次认证登录。" },
  { code: "1113", httpStatus: 429, message: "您的账户已欠费，请充值后重试" },
  { code: "1200", httpStatus: 500, message: "API 调用失败" },
  { code: "1210", httpStatus: 400, message: "API 调用参数有误，请检查文档" },
  { code: "1211", httpStatus: 400, message: "模型不存在，请检查模型代码" },
  { code: "1212", httpStatus: 400, message: "当前模型不支持 ${method} 调用方式" },
  { code: "1213", httpStatus: 400, message: "未正常接收到 ${field} 参数" },
  { code: "1214", httpStatus: 400, message: "${field} 参数非法。请检查文档" },
  { code: "1215", httpStatus: 400, message: "${field1} 与 ${field2} 不能同时设置，请检查文档" },
  { code: "1220", httpStatus: 403, message: "您无权访问 ${API_name}" },
  { code: "1221", httpStatus: 400, message: "API ${API_name} 已下线" },
  { code: "1222", httpStatus: 400, message: "API ${API_name} 不存在" },
  { code: "1230", httpStatus: 500, message: "API 调用流程出错" },
  { code: "1234", httpStatus: 500, message: "网络错误，错误id： ${error_id} ，请联系客服" },
  { code: "1261", httpStatus: 400, message: "Prompt 超长" },
  { code: "1301", httpStatus: 400, message: "系统检测到输入或生成内容可能包含不安全或敏感内容，请您避免输入易产生敏感内容的提示语，感谢您的配合" },
  { code: "1302", httpStatus: 429, message: "您的账户已达到速率限制，请您控制请求频率" },
  { code: "1305", httpStatus: 429, message: "该模型当前访问量过大，请您稍后再试" },
  { code: "1308", httpStatus: 429, message: "已达到 5 小时使用上限，${next_flush_time} 后可继续使用。如需超限额按量付费使用，可联系管理员开启超额按量付费。" },
  { code: "1309", httpStatus: 429, message: "您的 GLM Coding Plan 套餐已到期，暂无法使用，前往官方续订后即可恢复 https://bigmodel.cn/claude-code" },
  { code: "1310", httpStatus: 429, message: "已达到 7 天使用上限，${next_flush_time} 后可继续使用。如需超限额按量付费使用，可联系管理员开启超额按量付费。" },
  { code: "1311", httpStatus: 429, message: "当前订阅套餐暂未开放 ${model_name} 权限" },
  { code: "1313", httpStatus: 429, message: "您的账户当前使用模式不符合公平使用策略，请求频率已受到限制。详情请参阅《条款与协议-订阅及自动续费协议》，如需恢复请前往个人中心-编程套餐总览-顶部申请解除限制" },
  { code: "1314", httpStatus: 429, message: "您的企业套餐已失效，请联系企业管理员。" },
  { code: "1315", httpStatus: 429, message: "该 API Key 仅限企业编程套餐场景使用，请到官网更换对应产品类型的 API Key" },
  { code: "1316", httpStatus: 429, message: "已达到 5 小时使用上限。主账号余额不足，无法使用超额按量付费。您的限额将在 {next_flush_time} 重置。" },
  { code: "1317", httpStatus: 429, message: "已达到 7 天使用上限。主账号余额不足，无法使用超额按量付费。您的限额将在 {next_flush_time} 重置。" },
  { code: "1318", httpStatus: 429, message: "已达到 5 小时使用上限，且已达子账号月消费上限，无法使用超额按量付费，请联系管理员调整。您的限额将在 {next_flush_time} 重置。" },
  { code: "1319", httpStatus: 429, message: "已达到 7 天使用上限，且已达子账号月消费上限，无法使用超额按量付费，请联系管理员调整。您的限额将在 {next_flush_time} 重置。" },
  { code: "1320", httpStatus: 429, message: "已达到 5 小时使用上限，且已达企业级月消费上限，无法使用超额按量付费，请联系管理员调整。您的限额将在 {next_flush_time} 重置。" },
  { code: "1321", httpStatus: 429, message: "已达到 7 天使用上限，且已达企业级月消费上限，无法使用超额按量付费，请联系管理员调整。您的限额将在 {next_flush_time} 重置。" },
];

const BY_CODE = new Map(
  GLM_ERROR_CATALOG.filter((entry) => entry.code != null).map((entry) => [entry.code as string, entry]),
);

export const GLM_ERROR_CODE_DOC_URL = "https://docs.bigmodel.cn/cn/faq/api-code";

export function lookupGlmErrorCatalog(code: string | null | undefined): GlmErrorCatalogEntry | null {
  if (!code) return null;
  return BY_CODE.get(code) ?? null;
}

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

/**
 * Business codes that mean the Key is out of quota / subscription, not RPM.
 * 1308 / 1310 are the live coding-plan 5-hour / 7-day caps (not 1316 / 1317).
 * 1113 is balance. 1309 / 1314 / 1315 are dead until renewed.
 * 1316–1321 stay in the set so a future official-table reply still cools long.
 */
const QUOTA_EXHAUSTED_CODES = new Set([
  "1113",
  "1308",
  "1309",
  "1310",
  "1314",
  "1315",
  "1316",
  "1317",
  "1318",
  "1319",
  "1320",
  "1321",
]);

/**
 * Responses 协议没有 1310/1308，只能靠中文。Chat / Anthropic 有码时
 * 走 QUOTA_EXHAUSTED_CODES。套餐到期/失效类同样并入长冷却。
 */
const QUOTA_EXHAUSTED_MESSAGE_MARKERS = [
  "使用上限",
  "余额不足",
  "资源包",
  "欠费",
  "套餐已到期",
  "套餐已失效",
  "仅限企业编程套餐",
] as const;

export type UpstreamUsageCapKind = "five_hour" | "weekly" | "monthly" | "other";

export type UpstreamUsageCap = {
  kind: UpstreamUsageCapKind;
  /** Reset instant parsed from the upstream message (Asia/Shanghai wall time), if present. */
  resetAt: Date | null;
};

const USAGE_CAP_RESET_TIME = /(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/;

/** Zhipu reports limit reset times in Asia/Shanghai wall time. */
export function parseUsageCapResetAt(message: string): Date | null {
  const match = USAGE_CAP_RESET_TIME.exec(message);
  if (!match) return null;
  const parsed = new Date(`${match[1]}T${match[2]}+08:00`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function classifyUsageCapKind(
  code: string | null,
  message: string | null,
): UpstreamUsageCapKind {
  if (message) {
    if (/5\s*小时|5\s*[- ]?hours?/i.test(message)) return "five_hour";
    if (/7\s*天|7\s*[- ]?days?|每周|weekly/i.test(message)) return "weekly";
    if (/每月|monthly/i.test(message)) return "monthly";
  }
  if (code === "1308" || code === "1316" || code === "1318" || code === "1320") {
    return "five_hour";
  }
  if (code === "1310" || code === "1317" || code === "1319" || code === "1321") {
    return "weekly";
  }
  return "other";
}

/**
 * Detect a usage-cap / balance exhaustion reply and, when the upstream
 * message carries a reset timestamp ("…，2026-09-20 15:32:01 后可继续使用"),
 * surface it so cooling can end exactly at window reset instead of a fixed
 * cooldown. Employee-submitted keys may be drained outside this relay, so
 * the upstream reply is the authoritative quota signal.
 */
export function extractUpstreamUsageCap(payload: unknown): UpstreamUsageCap | null {
  const extracted = extractUpstreamBusinessError(payload);
  if (!extracted) return null;
  const code = extracted.code;
  const message = extracted.message;
  const byCode = code != null && QUOTA_EXHAUSTED_CODES.has(code);
  const byMessage = Boolean(
    message && QUOTA_EXHAUSTED_MESSAGE_MARKERS.some((marker) => message.includes(marker)),
  );
  if (!byCode && !byMessage) return null;
  return {
    kind: classifyUsageCapKind(code, message),
    resetAt: message ? parseUsageCapResetAt(message) : null,
  };
}

/** True when an upstream JSON envelope reports quota/balance exhaustion. */
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
