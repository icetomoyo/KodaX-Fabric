export const RELAY_PROTOCOLS = [
  "openai_chat",
  "anthropic_messages",
  "openai_responses",
] as const;

export type RelayProtocol = (typeof RELAY_PROTOCOLS)[number];

export const RELAY_BASE_PATH = "/ai" as const;

export type RelayAuthStyle = "bearer" | "x-api-key";

export type RelayProtocolConfig = {
  baseUrl: string;
  authStyle: RelayAuthStyle;
};

export type RelayProtocolConfigs = Partial<Record<RelayProtocol, RelayProtocolConfig>>;

export type RelayProtocolOption = {
  value: RelayProtocol;
  label: string;
  shortLabel: string;
  description: string;
  endpoint: string;
  authHeaders: readonly string[];
  /** Typical employee clients; one Key per client/protocol. */
  recommendedClients: readonly string[];
};

export const relayProtocolOptions: readonly RelayProtocolOption[] = [
  {
    value: "anthropic_messages",
    label: "Anthropic Message 协议",
    shortLabel: "Anthropic Message 协议",
    description: "Anthropic Messages 原生转发",
    endpoint: `POST ${RELAY_BASE_PATH}/v1/messages`,
    authHeaders: [
      "x-api-key: <你的 API Key>",
      "anthropic-version: 2023-06-01",
    ],
    recommendedClients: ["Claude Code", "CC Switch"],
  },
  {
    value: "openai_chat",
    label: "OpenAI Chat Completion 协议",
    shortLabel: "OpenAI Chat Completion 协议",
    description: "OpenAI Chat Completions 原生转发",
    endpoint: `POST ${RELAY_BASE_PATH}/chat/completions`,
    authHeaders: ["Authorization: Bearer <你的 API Key>"],
    recommendedClients: ["Cursor", "OpenAI 兼容客户端"],
  },
  {
    value: "openai_responses",
    label: "OpenAI Response 协议",
    shortLabel: "OpenAI Response 协议",
    description: "OpenAI Responses 原生转发",
    endpoint: `POST ${RELAY_BASE_PATH}/responses`,
    authHeaders: ["Authorization: Bearer <你的 API Key>"],
    recommendedClients: ["OpenAI Responses 客户端"],
  },
];

export function isRelayProtocol(value: unknown): value is RelayProtocol {
  return RELAY_PROTOCOLS.includes(value as RelayProtocol);
}

export function relayProtocolOption(protocol: RelayProtocol): RelayProtocolOption {
  return relayProtocolOptions.find((option) => option.value === protocol)!;
}

export function relayProtocolLabel(protocol: unknown, short = false): string {
  if (!isRelayProtocol(protocol)) return protocol ? String(protocol) : "未记录";
  const option = relayProtocolOption(protocol);
  return short ? option.shortLabel : option.label;
}

/** 员工侧统一使用 TokenHub 提供的 Base URL，不再按协议改写路径。 */
export function relayClientBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function relayClientSettings(protocol: RelayProtocol, baseUrl: string): string[] {
  const clientBaseUrl = relayClientBaseUrl(baseUrl);
  if (protocol === "anthropic_messages") {
    return [
      `ANTHROPIC_BASE_URL=${clientBaseUrl}`,
      "ANTHROPIC_AUTH_TOKEN=<你的 API Key>",
    ];
  }
  return [`OPENAI_BASE_URL=${clientBaseUrl}`];
}
