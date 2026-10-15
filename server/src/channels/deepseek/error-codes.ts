/**
 * DeepSeek 错误码就是 HTTP 状态码，见 https://api-docs.deepseek.com/zh-cn/quick_start/error_codes。
 * 报文里的 type / code 是 OpenAI 兼容的通用值，不区分原因，所以只看状态码：
 * - 402 余额不足：这把 Key 的账户没钱了，充值前不会自己好，长冷却、换 Key。
 * - 429 达到速率限制：这把 Key 被限速，短冷却、换 Key（核心默认）。
 * - 503 服务器繁忙：上游整体过载，与哪把 Key 无关，不冷却、不换 Key。
 */
import type { CooldownDecision } from "../types.js";

export function classifyDeepseekError(status: number, _body: string): CooldownDecision | null {
  if (status === 402) {
    return { rateLimitDisposition: "key_limited", usageCap: { kind: "other", resetAt: null } };
  }
  if (status === 503) return { rateLimitDisposition: "model_busy", usageCap: null };
  return null;
}
