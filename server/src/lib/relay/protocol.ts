export const RELAY_PROTOCOLS = [
  "openai_chat",
  "anthropic_messages",
  "openai_responses",
] as const;

export type RelayProtocol = (typeof RELAY_PROTOCOLS)[number];

export const DEFAULT_RELAY_PROTOCOL = "openai_chat" satisfies RelayProtocol;

export const RELAY_PATHS = {
  models: ["/models", "/v1/models"],
  chatCompletions: ["/v1/chat/completions", "/chat/completions"],
  responses: ["/v1/responses", "/responses"],
  messages: ["/v1/messages"],
  messagesCountTokens: ["/v1/messages/count_tokens"],
} as const;

const relayProtocolSet: ReadonlySet<string> = new Set(RELAY_PROTOCOLS);

export function isRelayProtocol(value: unknown): value is RelayProtocol {
  return typeof value === "string" && relayProtocolSet.has(value);
}
