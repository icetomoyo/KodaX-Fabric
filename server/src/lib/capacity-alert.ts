import { eq } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { env } from "../config.js";
import { db } from "../db/client.js";
import { productLines, upstreamCredentials } from "../db/schema/index.js";
import {
  effectiveCredentialStatus,
  type CredentialStatus,
} from "./credential-status.js";

export type CapacityCredentialRow = {
  productLineId: number;
  productLineName: string;
  credentialStatus: CredentialStatus | null;
  coolUntil: Date | null;
};

export type ProductLineCapacity = {
  productLineId: number;
  productLineName: string;
  coolingCount: number;
  poolCount: number;
  ratio: number | null;
};

export type CapacityAlertEvaluation = {
  skipped: boolean;
  ratio: number | null;
  shouldAlert: boolean;
  nextLastAlertAtMs: number | undefined;
};

/**
 * Pool = effective active + cooling. Disabled / auto_disabled are excluded.
 * Expired cooling follows effectiveCredentialStatus and counts as active.
 */
export function summarizeProductLineCapacity(
  rows: CapacityCredentialRow[],
  now: Date = new Date(),
): ProductLineCapacity[] {
  const byLine = new Map<number, ProductLineCapacity>();

  for (const row of rows) {
    let acc = byLine.get(row.productLineId);
    if (!acc) {
      acc = {
        productLineId: row.productLineId,
        productLineName: row.productLineName,
        coolingCount: 0,
        poolCount: 0,
        ratio: null,
      };
      byLine.set(row.productLineId, acc);
    }
    if (row.credentialStatus == null) continue;

    const status = effectiveCredentialStatus(row.credentialStatus, row.coolUntil, now);
    if (status === "cooling") {
      acc.coolingCount += 1;
      acc.poolCount += 1;
    } else if (status === "active") {
      acc.poolCount += 1;
    }
  }

  for (const acc of byLine.values()) {
    acc.ratio = acc.poolCount > 0 ? acc.coolingCount / acc.poolCount : null;
  }
  return [...byLine.values()];
}

/** Decide whether to emit an alert and how silence should change. */
export function evaluateCapacityAlert(input: {
  coolingCount: number;
  poolCount: number;
  threshold: number;
  lastAlertAtMs: number | undefined;
  nowMs: number;
  silenceMs: number;
}): CapacityAlertEvaluation {
  if (input.poolCount <= 0) {
    return {
      skipped: true,
      ratio: null,
      shouldAlert: false,
      nextLastAlertAtMs: input.lastAlertAtMs,
    };
  }

  const ratio = input.coolingCount / input.poolCount;
  if (ratio < input.threshold) {
    return {
      skipped: false,
      ratio,
      shouldAlert: false,
      nextLastAlertAtMs: undefined,
    };
  }

  const silenced =
    input.lastAlertAtMs !== undefined &&
    input.nowMs - input.lastAlertAtMs < input.silenceMs;
  if (silenced) {
    return {
      skipped: false,
      ratio,
      shouldAlert: false,
      nextLastAlertAtMs: input.lastAlertAtMs,
    };
  }

  return {
    skipped: false,
    ratio,
    shouldAlert: true,
    nextLastAlertAtMs: input.nowMs,
  };
}

export function formatCapacityAlertWebhookContent(input: {
  productLineName: string;
  coolingCount: number;
  poolCount: number;
  ratio: number;
  threshold: number;
  at: Date;
  timeZone: string;
}): string {
  const percent = (input.ratio * 100).toFixed(1);
  const thresholdPercent = (input.threshold * 100).toFixed(0);
  const time = new Intl.DateTimeFormat("zh-CN", {
    timeZone: input.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(input.at);
  return (
    `【容量告警】产品线「${input.productLineName}」冷却占比 ${percent}%` +
    `（${input.coolingCount}/${input.poolCount}），阈值 ${thresholdPercent}%。时间：${time}`
  );
}

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
const lastAlertAtByLine = new Map<number, number>();

async function loadCapacityRows(): Promise<CapacityCredentialRow[]> {
  return db
    .select({
      productLineId: productLines.id,
      productLineName: productLines.name,
      credentialStatus: upstreamCredentials.status,
      coolUntil: upstreamCredentials.coolUntil,
    })
    .from(productLines)
    .leftJoin(upstreamCredentials, eq(upstreamCredentials.productLineId, productLines.id))
    .where(eq(productLines.status, "active"));
}

async function postCapacityWebhook(
  logger: FastifyBaseLogger,
  productLineId: number,
  content: string,
): Promise<void> {
  const url = env.ALERT_WEBHOOK_URL;
  if (!url) return;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msgtype: "text", text: { content } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      logger.error(
        { productLineId, status: response.status },
        "capacity alert webhook failed",
      );
    }
  } catch (err) {
    logger.error({ err, productLineId }, "capacity alert webhook failed");
  }
}

export async function runCapacityAlertCheck(
  logger: FastifyBaseLogger,
  now: Date = new Date(),
): Promise<void> {
  const rows = await loadCapacityRows();
  const snapshots = summarizeProductLineCapacity(rows, now);
  const threshold = env.ALERT_COOLING_RATIO_THRESHOLD;
  const silenceMs = env.ALERT_SILENCE_SECONDS * 1_000;
  const nowMs = now.getTime();

  for (const snapshot of snapshots) {
    const decision = evaluateCapacityAlert({
      coolingCount: snapshot.coolingCount,
      poolCount: snapshot.poolCount,
      threshold,
      lastAlertAtMs: lastAlertAtByLine.get(snapshot.productLineId),
      nowMs,
      silenceMs,
    });

    if (decision.nextLastAlertAtMs === undefined) {
      lastAlertAtByLine.delete(snapshot.productLineId);
    } else {
      lastAlertAtByLine.set(snapshot.productLineId, decision.nextLastAlertAtMs);
    }

    if (!decision.shouldAlert || decision.ratio == null) continue;

    logger.warn(
      {
        productLineId: snapshot.productLineId,
        productLineName: snapshot.productLineName,
        coolingCount: snapshot.coolingCount,
        poolCount: snapshot.poolCount,
        ratio: decision.ratio,
        threshold,
      },
      "capacity cooling ratio above threshold",
    );

    await postCapacityWebhook(
      logger,
      snapshot.productLineId,
      formatCapacityAlertWebhookContent({
        productLineName: snapshot.productLineName,
        coolingCount: snapshot.coolingCount,
        poolCount: snapshot.poolCount,
        ratio: decision.ratio,
        threshold,
        at: now,
        timeZone: env.QUOTA_TIMEZONE,
      }),
    );
  }
}

async function tick(logger: FastifyBaseLogger): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    await runCapacityAlertCheck(logger);
  } catch (err) {
    logger.error({ err }, "capacity alert check failed");
  } finally {
    inFlight = false;
  }
}

export function startCapacityAlert(logger: FastifyBaseLogger): void {
  if (timer) return;

  const intervalMs = env.ALERT_CHECK_INTERVAL_SECONDS * 1_000;
  void tick(logger);
  timer = setInterval(() => {
    void tick(logger);
  }, intervalMs);
  timer.unref?.();
  process.once("exit", stopCapacityAlert);
}

export function stopCapacityAlert(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  inFlight = false;
  lastAlertAtByLine.clear();
}
