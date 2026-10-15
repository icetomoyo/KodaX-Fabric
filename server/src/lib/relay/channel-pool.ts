import { eq } from "drizzle-orm";
import { findChannelPlugin, findRelayVariant } from "../../channels/index.js";
import { db } from "../../db/client.js";
import { productLines, providers } from "../../db/schema/index.js";
import {
  resolveProtocolUpstreamConfig,
  type ProtocolUpstreamConfig,
} from "../upstream-protocol-config.js";
import { isValidRelayProductLineId } from "./types.js";
import type { RelayProtocol } from "./protocol.js";

export type RelayPool = {
  key: string;
  requestedProductLineId: number;
  productLineIds: number[];
  activeProductLineIds: number[];
  providerCode: string;
};

type PoolSibling = {
  id: number;
  status: string;
  providerStatus: string;
  providerCode: string;
};

/** Scheduling pool key is the channel (provider) code. */
export function channelPoolKey(providerCode: string): string {
  return providerCode.trim().toLowerCase();
}

export function pooledProductLineDisplayName(input: {
  relayPoolKey: string;
  productLineName: string;
}): string {
  return findChannelPlugin(input.relayPoolKey)?.meta.title ?? input.productLineName;
}

export function resolveRelayUpstreamConfig(input: {
  protocol: RelayProtocol;
  providerCode: string;
  productType: "api" | "coding_plan";
  protocolConfigs: unknown;
  legacyBaseUrl: string;
  legacyAuthStyle: string;
}): ProtocolUpstreamConfig | null {
  const plugin = findChannelPlugin(input.providerCode);
  const forced = plugin ? findRelayVariant(plugin) : undefined;
  if (forced) {
    const openaiChat = forced.protocolConfigs.openai_chat;
    return resolveProtocolUpstreamConfig({
      protocol: input.protocol,
      protocolConfigs: forced.protocolConfigs,
      legacyBaseUrl: openaiChat?.baseUrl ?? input.legacyBaseUrl,
      legacyAuthStyle: openaiChat?.authStyle ?? "bearer",
    });
  }
  return resolveProtocolUpstreamConfig({
    protocol: input.protocol,
    protocolConfigs: input.protocolConfigs,
    legacyBaseUrl: input.legacyBaseUrl,
    legacyAuthStyle: input.legacyAuthStyle,
  });
}

type RelayPoolDatabase = Pick<typeof db, "select">;

async function loadPoolSiblings(
  poolKey: string,
  executor: RelayPoolDatabase,
): Promise<PoolSibling[]> {
  return executor
    .select({
      id: productLines.id,
      status: productLines.status,
      providerStatus: providers.status,
      providerCode: providers.code,
    })
    .from(productLines)
    .innerJoin(providers, eq(productLines.providerId, providers.id))
    .where(eq(providers.code, poolKey));
}

function assemblePool(
  poolKey: string,
  requestedProductLineId: number,
  siblings: PoolSibling[],
  requestedActive: boolean,
  providerCode: string,
): RelayPool {
  const productLineIds = siblings.map((row) => row.id);
  const activeProductLineIds = siblings
    .filter((row) => row.status === "active" && row.providerStatus === "active")
    .map((row) => row.id);
  return {
    key: poolKey,
    requestedProductLineId,
    productLineIds: productLineIds.length > 0 ? productLineIds : [requestedProductLineId],
    activeProductLineIds: activeProductLineIds.length > 0
      ? activeProductLineIds
      : requestedActive
        ? [requestedProductLineId]
        : [],
    providerCode,
  };
}

export async function loadRelayPoolByProviderCode(
  providerCode: string,
  executor: RelayPoolDatabase = db,
): Promise<RelayPool | null> {
  const poolKey = channelPoolKey(providerCode);
  if (!poolKey) return null;
  const siblings = await loadPoolSiblings(poolKey, executor);
  if (siblings.length === 0) return null;
  const requested = siblings.find((row) =>
    row.status === "active" && row.providerStatus === "active"
  ) ?? siblings[0];
  return assemblePool(
    poolKey,
    requested.id,
    siblings,
    requested.status === "active" && requested.providerStatus === "active",
    requested.providerCode,
  );
}

export async function loadRelayPool(
  productLineId: number,
  executor: RelayPoolDatabase = db,
): Promise<RelayPool | null> {
  if (!isValidRelayProductLineId(productLineId)) return null;
  const [line] = await executor
    .select({
      id: productLines.id,
      status: productLines.status,
      providerCode: providers.code,
      providerStatus: providers.status,
    })
    .from(productLines)
    .innerJoin(providers, eq(productLines.providerId, providers.id))
    .where(eq(productLines.id, productLineId))
    .limit(1);
  if (!line) return null;

  const poolKey = channelPoolKey(line.providerCode);
  const siblings = await loadPoolSiblings(poolKey, executor);
  const requestedActive = line.status === "active" && line.providerStatus === "active";

  return assemblePool(
    poolKey,
    productLineId,
    siblings,
    requestedActive,
    line.providerCode,
  );
}
