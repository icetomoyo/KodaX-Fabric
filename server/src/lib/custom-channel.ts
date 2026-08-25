import { randomBytes } from "node:crypto";
import type { RelayProtocol } from "./relay/protocol.js";
import type { TemplateProtocolConfigResolution } from "./provider-templates.js";
import {
  normalizeUpstreamBaseUrl,
  parseProductLineProtocolConfigs,
  type ProductLineProtocolConfigs,
} from "./upstream-protocol-config.js";

export function allocateCustomProductLineCode(): string {
  return `c_${randomBytes(8).toString("hex")}`;
}

export function mergeCustomProtocolConfigs(
  stored: unknown,
  requested?: unknown,
): ProductLineProtocolConfigs {
  const base = parseProductLineProtocolConfigs(stored) ?? {};
  if (requested === undefined) return { ...base };
  const extra = parseProductLineProtocolConfigs(requested);
  if (!extra) return { ...base };
  return { ...base, ...extra };
}

export function resolveCustomProtocolConfigs(
  configs: unknown,
  protocols: readonly RelayProtocol[],
): TemplateProtocolConfigResolution {
  const parsed = parseProductLineProtocolConfigs(configs);
  if (!parsed) {
    return {
      ok: false,
      reason: "protocol_unsupported",
      unsupportedProtocols: [...protocols],
    };
  }

  const picked: ProductLineProtocolConfigs = {};
  const unsupportedProtocols: RelayProtocol[] = [];
  for (const protocol of protocols) {
    const config = parsed[protocol];
    if (!config) {
      unsupportedProtocols.push(protocol);
      continue;
    }
    picked[protocol] = {
      baseUrl: normalizeUpstreamBaseUrl(config.baseUrl),
      authStyle: config.authStyle,
    };
  }

  return unsupportedProtocols.length > 0
    ? { ok: false, reason: "protocol_unsupported", unsupportedProtocols }
    : { ok: true, configs: picked };
}
