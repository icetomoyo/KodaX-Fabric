/**
 * Release exclusive channel Keys that have had 0 tokens and 0 credits
 * for 5 hours back to the unbound pool.
 */
import type { FastifyBaseLogger } from "fastify";
import { releaseIdleCredentialBindings } from "./relay/binding.js";

const IDLE_BINDING_RELEASE_INTERVAL_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

export async function runIdleBindingReleaseOnce(
  logger: FastifyBaseLogger,
  now: Date = new Date(),
): Promise<number> {
  const released = await releaseIdleCredentialBindings(now);
  if (released > 0) {
    logger.info({ released }, "idle channel Key bindings released");
  }
  return released;
}

async function tick(logger: FastifyBaseLogger): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    await runIdleBindingReleaseOnce(logger);
  } catch (err) {
    logger.error({ err }, "idle channel Key release failed");
  } finally {
    inFlight = false;
  }
}

export function startIdleBindingRelease(logger: FastifyBaseLogger): void {
  if (timer) return;
  void tick(logger);
  timer = setInterval(() => {
    void tick(logger);
  }, IDLE_BINDING_RELEASE_INTERVAL_MS);
  timer.unref?.();
  process.once("exit", stopIdleBindingRelease);
}

export function stopIdleBindingRelease(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  inFlight = false;
}
