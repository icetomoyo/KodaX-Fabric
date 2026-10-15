import { deepseekChannel } from "./deepseek/index.js";
import { glmChannel } from "./glm/index.js";
import { huoshanChannel } from "./huoshan/index.js";
import { createChannelRegistry } from "./registry.js";
import type { ChannelPlugin, CooldownDecision } from "./types.js";
import { isAllowedChannelHost } from "./variants.js";

const registry = createChannelRegistry([
  glmChannel,
  deepseekChannel,
  huoshanChannel,
]);

export function getChannelPlugin(code: string): ChannelPlugin {
  return registry.get(code);
}

export function findChannelPlugin(code: string): ChannelPlugin | undefined {
  return registry.find(code);
}

export function listChannelPlugins(): readonly ChannelPlugin[] {
  return registry.list();
}

export function isChannelCode(code: string): boolean {
  return registry.isCode(code);
}

/**
 * Vendor-specific error classification. Each channel only reads its own error codes;
 * an unregistered provider code has no rules and falls back to the core defaults.
 */
export function classifyChannelError(
  providerCode: string | null | undefined,
  status: number,
  body: string,
): CooldownDecision | null {
  return findChannelPlugin(providerCode ?? "")?.classifyError?.(status, body) ?? null;
}

export function isTestableUpstreamUrl(providerCode: string, baseUrl: string): boolean {
  const plugin = findChannelPlugin(providerCode);
  return plugin ? isAllowedChannelHost(plugin, baseUrl) : false;
}

export type { ChannelPlugin, CooldownDecision, ProductType } from "./types.js";
export {
  allocateProductCode,
  findChannelVariant,
  findRelayVariant,
  resolveChannelVariant,
  resolveVariantProtocolConfigs,
  variantBaseUrl,
  variantProtocols,
} from "./variants.js";
