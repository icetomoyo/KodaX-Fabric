import { env } from "../../config.js";
import { redis } from "../../redis.js";
import { SupportBotError, supportBotRateLimited } from "./errors.js";

export function supportBotRateLimitKey(employeeId: number): string {
  return `support_bot:rl:${employeeId}`;
}

/**
 * Fixed 1-hour window. Redis outages fail open so support is not hard-down.
 */
export async function consumeSupportBotRateLimit(employeeId: number): Promise<void> {
  const limit = env.SUPPORT_BOT_RATE_LIMIT_PER_HOUR;
  const key = supportBotRateLimitKey(employeeId);
  const script = `
    local current = redis.call("INCR", KEYS[1])
    if current == 1 then redis.call("EXPIRE", KEYS[1], 3600) end
    return current
  `;
  try {
    const current = Number(await redis.eval(script, 1, key));
    if (Number.isFinite(current) && current > limit) {
      throw supportBotRateLimited();
    }
  } catch (error) {
    if (error instanceof SupportBotError) throw error;
    // Leave the bot usable when Redis is unreachable.
  }
}
