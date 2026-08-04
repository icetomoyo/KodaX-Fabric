export const RELAY_PROTOCOLS = [
  "openai_chat",
  "openai_responses",
  "anthropic_messages",
] as const;

export type RelayProtocol = (typeof RELAY_PROTOCOLS)[number];

export const DEFAULT_RELAY_PROTOCOL: RelayProtocol = "openai_chat";

const relayProtocolSet: ReadonlySet<string> = new Set(RELAY_PROTOCOLS);

export function isRelayProtocol(value: unknown): value is RelayProtocol {
  return typeof value === "string" && relayProtocolSet.has(value);
}
