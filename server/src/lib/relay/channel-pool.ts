import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { productLines, providers } from "../../db/schema/index.js";
import { getProviderTemplate } from "../provider-templates.js";
import {
  resolveProtocolUpstreamConfig,
  type ProtocolUpstreamConfig,
} from "../upstream-protocol-config.js";
import { isValidRelayProductLineId } from "./types.js";
import type { RelayProtocol } from "./protocol.js";

export const GLM_CODING_PLAN_POOL_KEY = "glm:coding_plan";
export const GLM_CODING_PLAN_DISPLAY_NAME = "GLM";

export type RelayPool = {
  key: string;
  requestedProductLineId: number;
  productLineIds: number[];
  activeProductLineIds: number[];
  providerCode: string;
};

type PoolLineInput = {
  id: number;
  providerCode: string;
  productType: "api" | "coding_plan";
};

/** Shared scheduling pool for interchangeable Zhipu coding-plan packages. */
export function relayPoolKeyForLine(input: PoolLineInput): string {
  if (input.providerCode === "glm" && input.productType === "coding_plan") {
    return GLM_CODING_PLAN_POOL_KEY;
  }
  return `line:${input.id}`;
}

export function isGlmCodingPlanPool(poolKey: string): boolean {
  return poolKey === GLM_CODING_PLAN_POOL_KEY;
}

export function pooledProductLineDisplayName(input: {
  relayPoolKey: string;
  productLineName: string;
}): string {
  if (isGlmCodingPlanPool(input.relayPoolKey)) return GLM_CODING_PLAN_DISPLAY_NAME;
  return input.productLineName;
}

export function glmDomesticProtocolConfigs() {
  const option = getProviderTemplate("glm")?.baseUrls[0];
  if (!option) {
    throw new Error("missing glm domestic protocol configs");
  }
  return option.protocolConfigs;
}

/** Zhipu coding-plan Keys always call the domestic gateway, including 国际套餐 KEY. */
export function resolveRelayUpstreamConfig(input: {
  protocol: RelayProtocol;
  providerCode: string;
  productType: "api" | "coding_plan";
  protocolConfigs: unknown;
  legacyBaseUrl: string;
  legacyAuthStyle: string;
}): ProtocolUpstreamConfig | null {
  if (input.providerCode === "glm" && input.productType === "coding_plan") {
    const domestic = glmDomesticProtocolConfigs();
    return resolveProtocolUpstreamConfig({
      protocol: input.protocol,
      protocolConfigs: domestic,
      legacyBaseUrl: domestic.openai_chat?.baseUrl ?? input.legacyBaseUrl,
      legacyAuthStyle: domestic.openai_chat?.authStyle ?? "bearer",
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

export async function findActiveProductLineIdByProviderCode(
  providerCode: string,
  executor: RelayPoolDatabase = db,
): Promise<number | null> {
  const code = providerCode.trim().toLowerCase();
  if (!code) return null;
  const [row] = await executor
    .select({ id: productLines.id })
    .from(productLines)
    .innerJoin(providers, eq(productLines.providerId, providers.id))
    .where(
      and(
        eq(providers.code, code),
        eq(providers.status, "active"),
        eq(productLines.status, "active"),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

export async function loadRelayPool(
  productLineId: number,
  executor: RelayPoolDatabase = db,
): Promise<RelayPool | null> {
  if (!isValidRelayProductLineId(productLineId)) return null;
  const [line] = await executor
    .select({
      id: productLines.id,
      relayPoolKey: productLines.relayPoolKey,
      productType: productLines.productType,
      status: productLines.status,
      providerCode: providers.code,
      providerStatus: providers.status,
    })
    .from(productLines)
    .innerJoin(providers, eq(productLines.providerId, providers.id))
    .where(eq(productLines.id, productLineId))
    .limit(1);
  if (!line) return null;

  const poolKey = line.relayPoolKey || relayPoolKeyForLine({
    id: line.id,
    providerCode: line.providerCode,
    productType: line.productType,
  });

  const siblings = await executor
    .select({
      id: productLines.id,
      status: productLines.status,
      providerStatus: providers.status,
    })
    .from(productLines)
    .innerJoin(providers, eq(productLines.providerId, providers.id))
    .where(eq(productLines.relayPoolKey, poolKey));

  const productLineIds = siblings.map((row) => row.id);
  const activeProductLineIds = siblings
    .filter((row) => row.status === "active" && row.providerStatus === "active")
    .map((row) => row.id);
  const requestedActive = line.status === "active" && line.providerStatus === "active";

  return {
    key: poolKey,
    requestedProductLineId: productLineId,
    productLineIds: productLineIds.length > 0 ? productLineIds : [line.id],
    activeProductLineIds: activeProductLineIds.length > 0
      ? activeProductLineIds
      : requestedActive
        ? [line.id]
        : [],
    providerCode: line.providerCode,
  };
}
