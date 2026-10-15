import { randomBytes } from "node:crypto";
import { RELAY_PROTOCOLS, type RelayProtocol } from "../lib/relay/protocol.js";
import {
  parseProductLineProtocolConfigs,
  type ProductLineProtocolConfigs,
  type ProtocolUpstreamConfig,
} from "../lib/upstream-protocol-config.js";
import type { ChannelPlugin, ChannelVariant } from "./types.js";

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function variantConfigs(variant: ChannelVariant): ProtocolUpstreamConfig[] {
  return Object.values(variant.protocolConfigs).filter(
    (config): config is ProtocolUpstreamConfig => Boolean(config),
  );
}

/** Representative base URL (OpenAI Chat first) for the legacy providers.default_base_url column. */
export function variantBaseUrl(variant: ChannelVariant): string {
  return variant.protocolConfigs.openai_chat?.baseUrl ?? variantConfigs(variant)[0]?.baseUrl ?? "";
}

export function variantProtocols(variant: ChannelVariant): RelayProtocol[] {
  return RELAY_PROTOCOLS.filter((protocol) => Boolean(variant.protocolConfigs[protocol]));
}

export function allocateProductCode(variant: ChannelVariant): string {
  return `${variant.codePrefix}_${randomBytes(8).toString("hex")}`;
}

/** Variant picked by a create request; no code means the channel's default variant. */
export function findChannelVariant(plugin: ChannelPlugin, code: unknown): ChannelVariant | undefined {
  if (code == null || code === "") return plugin.variants[0];
  return plugin.variants.find((variant) => variant.code === code);
}

export function findRelayVariant(plugin: ChannelPlugin): ChannelVariant | undefined {
  return plugin.relayVariant ? findChannelVariant(plugin, plugin.relayVariant) : undefined;
}

/** Map a stored product back to its variant by base URL, defaulting to the first variant. */
export function resolveChannelVariant(plugin: ChannelPlugin, protocolConfigs: unknown): ChannelVariant {
  const parsed = parseProductLineProtocolConfigs(protocolConfigs);
  if (parsed) {
    const storedUrls = new Set(
      Object.values(parsed)
        .filter((config): config is ProtocolUpstreamConfig => Boolean(config))
        .map((config) => normalizeBaseUrl(config.baseUrl)),
    );
    const matched = plugin.variants.find((variant) =>
      variantConfigs(variant).some((config) => storedUrls.has(normalizeBaseUrl(config.baseUrl))),
    );
    if (matched) return matched;
  }
  return plugin.variants[0];
}

export type ChannelProtocolConfigResolution =
  | { ok: true; configs: ProductLineProtocolConfigs }
  | { ok: false; reason: "product_line_unsupported"; unsupportedProtocols: RelayProtocol[] }
  | { ok: false; reason: "protocol_unsupported"; unsupportedProtocols: RelayProtocol[] };

export function resolveVariantProtocolConfigs(
  variant: ChannelVariant | undefined,
  protocols: readonly RelayProtocol[],
): ChannelProtocolConfigResolution {
  if (!variant) {
    return { ok: false, reason: "product_line_unsupported", unsupportedProtocols: [...protocols] };
  }
  const configs: ProductLineProtocolConfigs = {};
  const unsupportedProtocols: RelayProtocol[] = [];
  for (const protocol of protocols) {
    const config = variant.protocolConfigs[protocol];
    if (!config) {
      unsupportedProtocols.push(protocol);
      continue;
    }
    configs[protocol] = { ...config };
  }
  return unsupportedProtocols.length > 0
    ? { ok: false, reason: "protocol_unsupported", unsupportedProtocols }
    : { ok: true, configs };
}

/** Official channels may only be probed at their documented HTTPS hosts. */
export function isAllowedChannelHost(plugin: ChannelPlugin, value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && plugin.variants.some((variant) =>
        variantConfigs(variant).some((config) => new URL(config.baseUrl).hostname === url.hostname),
      );
  } catch {
    return false;
  }
}
