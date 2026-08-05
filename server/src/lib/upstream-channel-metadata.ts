import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  productLines,
  providers,
  upstreamCredentials,
} from "../db/schema/index.js";
import { effectiveCredentialStatus, type CredentialStatus } from "./credential-status.js";
import {
  RELAY_PROTOCOLS,
  type RelayProtocol,
} from "./relay/protocol.js";
import {
  configuredProtocols,
  parseProductLineProtocolConfigs,
} from "./upstream-protocol-config.js";

export type EmployeeUpstreamChannel = {
  productLineId: number;
  productLineCode: string;
  productLineName: string;
  productType: "api" | "coding_plan";
  providerId: number;
  providerCode: string;
  providerName: string;
  compatibleProtocols: RelayProtocol[];
  credentialCount: number;
};

export type UpstreamChannelCredentialMetadataRow = {
  credentialId: number;
  credentialStatus: CredentialStatus;
  coolUntil: Date | null;
  credentialWeight: number;
  supportedProtocols: readonly RelayProtocol[] | null;
  protocolConfigs: unknown;
  productLineId: number;
  productLineCode: string;
  productLineName: string;
  productType: "api" | "coding_plan";
  providerId: number;
  providerCode: string;
  providerName: string;
};

type UpstreamChannelMetadataDatabase = Pick<typeof db, "select">;

type UpstreamChannelMetadataOptions = {
  /** Keep the validated configuration stable until a surrounding create transaction commits. */
  lockForCreate?: boolean;
  productLineId?: number;
};

function normalizedProtocols(
  configured: readonly RelayProtocol[] | null,
): RelayProtocol[] {
  const selected = new Set(configured ?? []);
  return RELAY_PROTOCOLS.filter((protocol) => selected.has(protocol));
}

function compareStableText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Pure aggregation shared by GET metadata and POST create validation. */
export function collectEmployeeUpstreamChannels(
  rows: readonly UpstreamChannelCredentialMetadataRow[],
  now: Date = new Date(),
): EmployeeUpstreamChannel[] {
  const channels = new Map<
    number,
    Omit<EmployeeUpstreamChannel, "compatibleProtocols"> & {
      compatibleProtocols: Set<RelayProtocol>;
    }
  >();

  for (const row of rows) {
    if (row.credentialWeight <= 0) continue;
    const status = effectiveCredentialStatus(row.credentialStatus, row.coolUntil, now);
    if (status !== "active" && status !== "cooling") continue;

    const credentialProtocols = normalizedProtocols(row.supportedProtocols);
    const storedConfigs = parseProductLineProtocolConfigs(row.protocolConfigs);
    const channelProtocols = storedConfigs === null
      ? null
      : new Set<RelayProtocol>(configuredProtocols(storedConfigs));
    const protocols = storedConfigs === null
      ? credentialProtocols
      : credentialProtocols.filter((protocol) => channelProtocols?.has(protocol));
    if (protocols.length === 0) continue;

    let channel = channels.get(row.productLineId);
    if (!channel) {
      channel = {
        productLineId: row.productLineId,
        productLineCode: row.productLineCode,
        productLineName: row.productLineName,
        productType: row.productType,
        providerId: row.providerId,
        providerCode: row.providerCode,
        providerName: row.providerName,
        compatibleProtocols: new Set<RelayProtocol>(),
        credentialCount: 0,
      };
      channels.set(row.productLineId, channel);
    }

    channel.credentialCount += 1;
    for (const protocol of protocols) channel.compatibleProtocols.add(protocol);
  }

  return [...channels.values()]
    .map((channel) => ({
      ...channel,
      compatibleProtocols: RELAY_PROTOCOLS.filter((protocol) =>
        channel.compatibleProtocols.has(protocol)
      ),
    }))
    .filter((channel) => channel.compatibleProtocols.length > 0)
    .sort((a, b) =>
      compareStableText(a.providerName, b.providerName) ||
      compareStableText(a.productLineName, b.productLineName) ||
      a.productLineId - b.productLineId
    );
}

export async function getEmployeeUpstreamChannels(
  _employeeId: number,
  executor: UpstreamChannelMetadataDatabase = db,
  options: UpstreamChannelMetadataOptions = {},
): Promise<EmployeeUpstreamChannel[]> {
  const rowsQuery = executor
    .select({
      credentialId: upstreamCredentials.id,
      credentialStatus: upstreamCredentials.status,
      coolUntil: upstreamCredentials.coolUntil,
      credentialWeight: upstreamCredentials.weight,
      supportedProtocols: upstreamCredentials.supportedProtocols,
      protocolConfigs: productLines.protocolConfigs,
      productLineId: productLines.id,
      productLineCode: productLines.code,
      productLineName: productLines.name,
      productType: productLines.productType,
      providerId: providers.id,
      providerCode: providers.code,
      providerName: providers.name,
    })
    .from(upstreamCredentials)
    .innerJoin(productLines, eq(upstreamCredentials.productLineId, productLines.id))
    .innerJoin(providers, eq(productLines.providerId, providers.id))
    .where(
      and(
        eq(providers.status, "active"),
        eq(productLines.status, "active"),
        inArray(upstreamCredentials.status, ["active", "cooling"]),
        gt(upstreamCredentials.weight, 0),
        options.productLineId === undefined
          ? undefined
          : eq(productLines.id, options.productLineId),
      ),
    );
  const rows = options.lockForCreate
    ? await rowsQuery.for("share")
    : await rowsQuery;
  return collectEmployeeUpstreamChannels(rows);
}

export async function getEmployeeUpstreamChannel(
  employeeId: number,
  productLineId: number,
  executor: UpstreamChannelMetadataDatabase = db,
  options: UpstreamChannelMetadataOptions = {},
): Promise<EmployeeUpstreamChannel | null> {
  const channels = await getEmployeeUpstreamChannels(employeeId, executor, {
    ...options,
    productLineId,
  });
  return channels.find((channel) => channel.productLineId === productLineId) ?? null;
}
