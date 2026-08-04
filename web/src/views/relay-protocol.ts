export const RELAY_PROTOCOLS = [
  "openai_chat",
  "openai_responses",
  "anthropic_messages",
] as const;

export type RelayProtocol = (typeof RELAY_PROTOCOLS)[number];

export type RelayProtocolOption = {
  value: RelayProtocol;
  label: string;
  shortLabel: string;
  description: string;
  endpoint: string;
  authHeaders: readonly string[];
};

export const relayProtocolOptions: readonly RelayProtocolOption[] = [
  {
    value: "openai_chat",
    label: "OpenAI 对话（Chat Completions）",
    shortLabel: "OpenAI 对话",
    description: "适用于 OpenAI Chat Completions 兼容客户端",
    endpoint: "POST /v1/chat/completions",
    authHeaders: ["Authorization: Bearer <你的 API Key>"],
  },
  {
    value: "openai_responses",
    label: "OpenAI 响应（Responses / Codex）",
    shortLabel: "OpenAI Responses",
    description: "适用于 OpenAI Responses API、Codex 和兼容客户端",
    endpoint: "POST /v1/responses",
    authHeaders: ["Authorization: Bearer <你的 API Key>"],
  },
  {
    value: "anthropic_messages",
    label: "Anthropic 消息（Claude）",
    shortLabel: "Claude Messages",
    description: "适用于 Anthropic SDK、Claude Code 和兼容客户端",
    endpoint: "POST /v1/messages",
    authHeaders: [
      "x-api-key: <你的 API Key>",
      "anthropic-version: 2023-06-01",
    ],
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

export function relayClientBaseUrl(protocol: RelayProtocol, baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (protocol === "anthropic_messages") {
    return normalized.replace(/\/v1$/i, "");
  }
  return normalized;
}

export function relayClientSettings(protocol: RelayProtocol, baseUrl: string): string[] {
  const clientBaseUrl = relayClientBaseUrl(protocol, baseUrl);
  if (protocol === "anthropic_messages") {
    return [
      `ANTHROPIC_BASE_URL=${clientBaseUrl}`,
      "ANTHROPIC_AUTH_TOKEN=<你的 API Key>",
    ];
  }
  if (protocol === "openai_responses") {
    return [
      `OPENAI_BASE_URL=${clientBaseUrl}`,
      `Codex provider base_url = "${clientBaseUrl}"`,
    ];
  }
  return [`OPENAI_BASE_URL=${clientBaseUrl}`];
}
