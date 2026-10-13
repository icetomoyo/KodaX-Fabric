/**
 * Release members who have not called through their channel Key for
 * RELAY_KEY_IDLE_RELEASE_SECONDS, and return Keys nobody is on to the
 * unbound pool.
 */
import type { FastifyBaseLogger } from "fastify";
import { env } from "../config.js";
import { releaseIdleCredentialBindings } from "./relay/binding.js";

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

export async function runIdleBindingReleaseOnce(
  logger: FastifyBaseLogger,
  now: Date = new Date(),
): Promise<{ members: number; bindings: number }> {
  const released = await releaseIdleCredentialBindings(now);
  if (released.members > 0 || released.bindings > 0) {
    logger.info(released, "idle channel Key members released");
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
  }, env.RELAY_KEY_IDLE_SWEEP_SECONDS * 1_000);
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
