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

/** 员工侧唯一公开的 TokenHub Base URL 路径。 */
export const RELAY_BASE_PATH = "/ai" as const;

export const RELAY_ENDPOINTS = {
  models: `${RELAY_BASE_PATH}/models`,
  anthropicModels: `${RELAY_BASE_PATH}/v1/models`,
  chatCompletions: `${RELAY_BASE_PATH}/chat/completions`,
  responses: `${RELAY_BASE_PATH}/responses`,
  responsesCompact: `${RELAY_BASE_PATH}/responses/compact`,
  messages: `${RELAY_BASE_PATH}/v1/messages`,
  messagesCountTokens: `${RELAY_BASE_PATH}/v1/messages/count_tokens`,
} as const;

const relayProtocolSet: ReadonlySet<string> = new Set(RELAY_PROTOCOLS);

export function isRelayProtocol(value: unknown): value is RelayProtocol {
  return typeof value === "string" && relayProtocolSet.has(value);
}
