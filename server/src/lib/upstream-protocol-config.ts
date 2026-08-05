import {
  CONFIGURABLE_RELAY_PROTOCOLS,
  type ConfigurableRelayProtocol,
  type RelayProtocol,
} from "./relay/protocol.js";

export const UPSTREAM_AUTH_STYLES = ["bearer", "x-api-key"] as const;
export type UpstreamAuthStyle = (typeof UPSTREAM_AUTH_STYLES)[number];

export type ProtocolUpstreamConfig = {
  baseUrl: string;
  authStyle: UpstreamAuthStyle;
};

export type ProductLineProtocolConfigs = Partial<
  Record<ConfigurableRelayProtocol, ProtocolUpstreamConfig>
>;

export function normalizeUpstreamBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function isUpstreamAuthStyle(value: unknown): value is UpstreamAuthStyle {
  return typeof value === "string" && UPSTREAM_AUTH_STYLES.includes(value as UpstreamAuthStyle);
}

export function parseProductLineProtocolConfigs(
  value: unknown,
): ProductLineProtocolConfigs | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return {};

  const source = value as Record<string, unknown>;
  const parsed: ProductLineProtocolConfigs = {};
  for (const protocol of CONFIGURABLE_RELAY_PROTOCOLS) {
    const candidate = source[protocol];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const config = candidate as Record<string, unknown>;
    if (typeof config.baseUrl !== "string" || !isUpstreamAuthStyle(config.authStyle)) continue;
    const baseUrl = normalizeUpstreamBaseUrl(config.baseUrl);
    try {
      const url = new URL(baseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    } catch {
      continue;
    }
    parsed[protocol] = { baseUrl, authStyle: config.authStyle };
  }
  return parsed;
}

export function configuredProtocols(
  configs: ProductLineProtocolConfigs | null,
): ConfigurableRelayProtocol[] {
  if (!configs) return [];
  return CONFIGURABLE_RELAY_PROTOCOLS.filter((protocol) => configs[protocol] !== undefined);
}

export function resolveProtocolUpstreamConfig(input: {
  protocol: RelayProtocol;
  protocolConfigs: unknown;
  legacyBaseUrl: string;
  legacyAuthStyle: string;
}): ProtocolUpstreamConfig | null {
  const configs = parseProductLineProtocolConfigs(input.protocolConfigs);
  if (configs === null) {
    if (!isUpstreamAuthStyle(input.legacyAuthStyle)) return null;
    return {
      baseUrl: normalizeUpstreamBaseUrl(input.legacyBaseUrl),
      authStyle: input.legacyAuthStyle,
    };
  }
  if (!CONFIGURABLE_RELAY_PROTOCOLS.includes(input.protocol as ConfigurableRelayProtocol)) {
    return null;
  }
  return configs[input.protocol as ConfigurableRelayProtocol] ?? null;
}

export function effectiveProtocolConfigs(input: {
  protocols: readonly RelayProtocol[];
  protocolConfigs: unknown;
  legacyBaseUrl: string;
  legacyAuthStyle: string;
}): Partial<Record<RelayProtocol, ProtocolUpstreamConfig>> {
  const result: Partial<Record<RelayProtocol, ProtocolUpstreamConfig>> = {};
  for (const protocol of input.protocols) {
    const config = resolveProtocolUpstreamConfig({ ...input, protocol });
    if (config) result[protocol] = config;
  }
  return result;
}

export function protocolConfigsEqual(
  left: Partial<Record<RelayProtocol, ProtocolUpstreamConfig>>,
  right: Partial<Record<RelayProtocol, ProtocolUpstreamConfig>>,
): boolean {
  const protocols = new Set<RelayProtocol>([
    ...(Object.keys(left) as RelayProtocol[]),
    ...(Object.keys(right) as RelayProtocol[]),
  ]);
  for (const protocol of protocols) {
    const leftConfig = left[protocol];
    const rightConfig = right[protocol];
    if (!leftConfig || !rightConfig) return false;
    if (
      normalizeUpstreamBaseUrl(leftConfig.baseUrl) !==
        normalizeUpstreamBaseUrl(rightConfig.baseUrl) ||
      leftConfig.authStyle !== rightConfig.authStyle
    ) {
      return false;
    }
  }
  return true;
}

export type EmptyChannelProtocolConfigInitializationPlan = {
  shouldInitialize: boolean;
  nextConfigVersion: number;
};

/**
 * Decide whether the first credential may initialise a template channel.
 * Existing credentials make legacy routing observable, so they are never
 * migrated implicitly. A non-null configuration remains authoritative when
 * the caller omitted protocols; an explicit protocol choice may repair a
 * still-empty channel whose stored template configuration drifted.
 */
export function planEmptyChannelProtocolConfigInitialization(input: {
  credentialCount: number;
  currentProtocolConfigs: unknown;
  targetProtocolConfigs: ProductLineProtocolConfigs;
  currentConfigVersion: number;
  protocolsExplicitlyRequested: boolean;
}): EmptyChannelProtocolConfigInitializationPlan {
  const current = parseProductLineProtocolConfigs(input.currentProtocolConfigs);
  const shouldInitialize = input.credentialCount === 0 && (
    current === null ||
    (input.protocolsExplicitlyRequested &&
      !protocolConfigsEqual(current, input.targetProtocolConfigs))
  );

  return {
    shouldInitialize,
    nextConfigVersion: shouldInitialize
      ? input.currentConfigVersion + 1
      : input.currentConfigVersion,
  };
}
