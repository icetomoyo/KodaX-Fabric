export const RELAY_PROTOCOLS = [
  "openai_chat",
  "openai_responses",
  "anthropic_messages",
] as const;

export type RelayProtocol = (typeof RELAY_PROTOCOLS)[number];

// New configuration intentionally excludes Responses. RELAY_PROTOCOLS stays
// unchanged so legacy database rows and API keys remain routable.
export const CONFIGURABLE_RELAY_PROTOCOLS = [
  "openai_chat",
  "anthropic_messages",
] as const satisfies readonly RelayProtocol[];

export type ConfigurableRelayProtocol = (typeof CONFIGURABLE_RELAY_PROTOCOLS)[number];

export const DEFAULT_RELAY_PROTOCOL = "openai_chat" satisfies RelayProtocol;

const relayProtocolSet: ReadonlySet<string> = new Set(RELAY_PROTOCOLS);

export function isRelayProtocol(value: unknown): value is RelayProtocol {
  return typeof value === "string" && relayProtocolSet.has(value);
}
