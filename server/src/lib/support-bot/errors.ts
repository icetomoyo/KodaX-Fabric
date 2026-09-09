export class SupportBotError extends Error {
  readonly httpStatus: number;
  readonly code: string;

  constructor(httpStatus: number, code: string, message: string) {
    super(message);
    this.name = "SupportBotError";
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

export function supportBotUnavailable(message = "问答助手暂时不可用，请稍后再试或查看接入教程"): SupportBotError {
  return new SupportBotError(503, "SUPPORT_BOT_UNAVAILABLE", message);
}

export function supportBotRateLimited(message = "提问过于频繁，请一小时后再试"): SupportBotError {
  return new SupportBotError(429, "SUPPORT_BOT_RATE_LIMITED", message);
}

export function supportBotUpstreamError(
  message = "问答助手暂时无法回答，请稍后再试",
): SupportBotError {
  return new SupportBotError(502, "SUPPORT_BOT_UPSTREAM_ERROR", message);
}

export function supportBotConversationNotFound(): SupportBotError {
  return new SupportBotError(404, "SUPPORT_BOT_CONVERSATION_NOT_FOUND", "会话不存在");
}

export function supportBotInvalidMessage(
  message = "消息长度须为 1–2000 个字符",
): SupportBotError {
  return new SupportBotError(400, "INVALID_MESSAGE", message);
}
