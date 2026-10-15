/**
 * 火山方舟错误码。以公共错误码 https://www.volcengine.com/docs/82379/1299023 为底；
 * Agent Plan / Coding Plan 的额度用尽按线上原文对齐：
 *   429 AccountQuotaExceeded
 *   "You have exceeded the 5-hour usage quota. It will reset at 2026-09-20 15:32:01 +0800 CST."
 *   （weekly / monthly 同句式）
 * 欠费 AccountOverdueError 是 HTTP 403，核心按鉴权失败停用，不经过这里。
 */
import {
  extractUpstreamBusinessError,
  parseUsageCapResetAt,
  type UpstreamUsageCap,
  type UpstreamUsageCapKind,
} from "../../lib/upstream-error.js";
import type { CooldownDecision } from "../types.js";

/** 套餐 5 小时 / 周 / 月额度用尽。 */
const ACCOUNT_QUOTA_EXCEEDED = "AccountQuotaExceeded";

/** 模型的免费试用额度用完，要在控制台开通模型服务才能继续。 */
const FREE_QUOTA_EXCEEDED = "QuotaExceeded";

/** 服务端资源不足（流量突增、闲置接入点首次调用）或模型还在加载：与哪把 Key 无关。 */
const MODEL_BUSY_CODES = new Set(["ServerOverloaded", "ModelLoadingError"]);

function usageCapKind(message: string | null): UpstreamUsageCapKind {
  if (!message) return "other";
  if (/5-hour/i.test(message)) return "five_hour";
  if (/weekly/i.test(message)) return "weekly";
  if (/monthly/i.test(message)) return "monthly";
  return "other";
}

/**
 * 其余 429（RequestBurstTooFast、RateLimitExceeded.*、ModelAccount*RateLimitExceeded）
 * 都是这把 Key 被限速，按核心默认短冷却、换 Key。
 */
export function classifyHuoshanError(_status: number, body: string): CooldownDecision {
  const extracted = extractUpstreamBusinessError(body);
  const code = extracted?.code ?? null;
  const message = extracted?.message ?? null;
  let usageCap: UpstreamUsageCap | null = null;
  if (code === ACCOUNT_QUOTA_EXCEEDED || message?.includes(ACCOUNT_QUOTA_EXCEEDED)) {
    usageCap = {
      kind: usageCapKind(message),
      resetAt: message ? parseUsageCapResetAt(message) : null,
    };
  } else if (code === FREE_QUOTA_EXCEEDED) {
    usageCap = { kind: "other", resetAt: null };
  }
  return {
    rateLimitDisposition: code && MODEL_BUSY_CODES.has(code) ? "model_busy" : "key_limited",
    usageCap,
  };
}
