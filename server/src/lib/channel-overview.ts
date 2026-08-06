import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { productLines, providers, upstreamCredentials } from "../db/schema/index.js";
import {
  effectiveCredentialStatus,
  type CredentialStatus,
} from "./credential-status.js";

export type ChannelCredentialRow = {
  productLineId: number;
  productLineStatus: string;
  providerStatus: string;
  credentialStatus: CredentialStatus | null;
  coolUntil: Date | null;
  weight: number | null;
};

export type ChannelOverviewStats = {
  total: number;
  enabled: number;
  unavailable: number;
};

/**
 * Aggregate channel (product_line) metrics.
 *
 * - total: every product line is one channel
 * - enabled: provider + product line both active
 * - unavailable: enabled channels with zero schedulable keys
 *
 * Schedulable key: effective status is active and weight > 0.
 */
export function summarizeChannelOverview(
  rows: ChannelCredentialRow[],
  now: Date = new Date(),
): ChannelOverviewStats {
  type Acc = {
    productLineStatus: string;
    providerStatus: string;
    hasSchedulable: boolean;
  };

  const byLine = new Map<number, Acc>();

  for (const row of rows) {
    let acc = byLine.get(row.productLineId);
    if (!acc) {
      acc = {
        productLineStatus: row.productLineStatus,
        providerStatus: row.providerStatus,
        hasSchedulable: false,
      };
      byLine.set(row.productLineId, acc);
    }

    if (row.credentialStatus == null) continue;
    if (acc.hasSchedulable) continue;

    const weight = Number(row.weight ?? 0);
    if (!(weight > 0)) continue;

    const status = effectiveCredentialStatus(row.credentialStatus, row.coolUntil, now);
    if (status === "active") {
      acc.hasSchedulable = true;
    }
  }

  let total = 0;
  let enabled = 0;
  let unavailable = 0;

  for (const acc of byLine.values()) {
    total += 1;
    const isEnabled = acc.providerStatus === "active" && acc.productLineStatus === "active";
    if (!isEnabled) continue;
    enabled += 1;
    if (!acc.hasSchedulable) unavailable += 1;
  }

  return { total, enabled, unavailable };
}

export async function loadChannelOverviewRows(): Promise<ChannelCredentialRow[]> {
  return db
    .select({
      productLineId: productLines.id,
      productLineStatus: productLines.status,
      providerStatus: providers.status,
      credentialStatus: upstreamCredentials.status,
      coolUntil: upstreamCredentials.coolUntil,
      weight: upstreamCredentials.weight,
    })
    .from(productLines)
    .innerJoin(providers, eq(productLines.providerId, providers.id))
    .leftJoin(upstreamCredentials, eq(upstreamCredentials.productLineId, productLines.id));
}

export async function getChannelOverviewStats(
  now: Date = new Date(),
): Promise<ChannelOverviewStats> {
  const rows = await loadChannelOverviewRows();
  return summarizeChannelOverview(rows, now);
}
