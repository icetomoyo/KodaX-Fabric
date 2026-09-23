export const RELAY_PROTOCOLS = [
  "openai_chat",
  "anthropic_messages",
  "openai_responses",
] as const;

export type RelayProtocol = (typeof RELAY_PROTOCOLS)[number];

export const DEFAULT_RELAY_PROTOCOL = "openai_chat" satisfies RelayProtocol;

/** Legacy employee relay prefix; still accepted alongside origin paths. */
export const RELAY_BASE_PATH = "/ai" as const;

export const RELAY_PATHS = {
  models: ["/ai/models", "/ai/v1/models", "/models", "/v1/models"],
  chatCompletions: [
    "/ai/chat/completions",
    "/v1/chat/completions",
    "/chat/completions",
  ],
  responses: ["/ai/responses", "/ai/v1/responses", "/v1/responses", "/responses"],
  messages: ["/ai/v1/messages", "/v1/messages"],
  messagesCountTokens: [
    "/ai/v1/messages/count_tokens",
    "/v1/messages/count_tokens",
  ],
} as const;

export const RELAY_ENDPOINTS = {
  models: RELAY_PATHS.models[0],
  anthropicModels: RELAY_PATHS.models[1],
  chatCompletions: RELAY_PATHS.chatCompletions[0],
  responses: RELAY_PATHS.responses[0],
  responsesV1: RELAY_PATHS.responses[1],
  messages: RELAY_PATHS.messages[0],
  messagesCountTokens: RELAY_PATHS.messagesCountTokens[0],
} as const;

const relayProtocolSet: ReadonlySet<string> = new Set(RELAY_PROTOCOLS);

export function isRelayProtocol(value: unknown): value is RelayProtocol {
  return typeof value === "string" && relayProtocolSet.has(value);
}
