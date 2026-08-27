/**
 * 智谱开放平台错误码原文，对照 https://docs.bigmodel.cn/cn/faq/api-code
 * 三列与官方表一致：业务错误码、HTTP 状态码、错误信息。不改写官方文案。
 */
export type GlmErrorCatalogEntry = {
  code: string | null;
  httpStatus: number;
  message: string;
};

/** 官方表原文。占位符（${field} 等）保持文档写法。 */
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
  { code: "1308", httpStatus: 429, message: "已达到 ${number} ${unit} 的使用上限。您的限额将在 ${next_flush_time} 重置" },
  { code: "1309", httpStatus: 429, message: "您的 GLM Coding Plan 套餐已到期，暂无法使用，前往官方续订后即可恢复 https://bigmodel.cn/claude-code" },
  { code: "1310", httpStatus: 429, message: "您已达到每周/每月使用上限，您的限额将在 ${next_flush_time} 重置" },
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
