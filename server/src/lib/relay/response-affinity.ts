import { createHash } from "node:crypto";
import { redis } from "../../redis.js";
import type { RelayCandidate } from "./types.js";

const RESPONSE_AFFINITY_TTL_SECONDS = 30 * 24 * 60 * 60;

export type RelayResponseAffinity = {
  credentialId: number;
  productLineId: number;
  upstreamModel: string;
};

export function relayResponseAffinityKey(employeeId: number, responseId: string): string {
  const digest = createHash("sha256").update(responseId).digest("hex");
  return `tokenhub:relay:response-affinity:v1:${employeeId}:${digest}`;
}

async function ensureRedisReady(): Promise<void> {
  if (redis.status === "ready") return;
  const pong = await redis.ping();
  if (pong !== "PONG") throw new Error("Redis PING failed");
}

export async function rememberRelayResponseAffinity(
  employeeId: number,
  responseId: string,
  candidate: RelayCandidate,
): Promise<void> {
  if (!responseId || responseId.length > 512) return;
  await ensureRedisReady();
  const value: RelayResponseAffinity = {
    credentialId: candidate.credentialId,
    productLineId: candidate.productLineId,
    upstreamModel: candidate.upstreamModel,
  };
  await redis.set(
    relayResponseAffinityKey(employeeId, responseId),
    JSON.stringify(value),
    "EX",
    RESPONSE_AFFINITY_TTL_SECONDS,
  );
}

export async function findRelayResponseAffinity(
  employeeId: number,
  responseId: string,
): Promise<RelayResponseAffinity | null> {
  if (!responseId || responseId.length > 512) return null;
  await ensureRedisReady();
  const raw = await redis.get(relayResponseAffinityKey(employeeId, responseId));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<RelayResponseAffinity>;
    if (
      !Number.isInteger(value.credentialId) ||
      !Number.isInteger(value.productLineId) ||
      typeof value.upstreamModel !== "string" ||
      !value.upstreamModel
    ) {
      return null;
    }
    return value as RelayResponseAffinity;
  } catch {
    return null;
  }
}

export function candidateMatchesResponseAffinity(
  candidate: RelayCandidate,
  affinity: RelayResponseAffinity,
): boolean {
  return candidate.credentialId === affinity.credentialId &&
    candidate.productLineId === affinity.productLineId &&
    candidate.upstreamModel === affinity.upstreamModel;
}
