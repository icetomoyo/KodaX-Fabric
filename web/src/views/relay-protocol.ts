export const RELAY_PROTOCOLS = [
  "openai_chat",
  "openai_responses",
  "anthropic_messages",
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
};

const relayProtocolDefinitions: readonly RelayProtocolOption[] = [
  {
    value: "openai_chat",
    label: "OpenAI 对话（Chat Completions）",
    shortLabel: "OpenAI 对话",
    description: "适用于 OpenAI Chat Completions 兼容客户端",
    endpoint: `POST ${RELAY_BASE_PATH}/chat/completions`,
    authHeaders: ["Authorization: Bearer <你的 API Key>"],
  },
  {
    value: "openai_responses",
    label: "OpenAI 响应（Responses / Codex，旧协议）",
    shortLabel: "OpenAI Responses（旧协议）",
    description: "仅用于兼容已创建的 OpenAI Responses API Key",
    endpoint: `POST ${RELAY_BASE_PATH}/responses`,
    authHeaders: ["Authorization: Bearer <你的 API Key>"],
  },
  {
    value: "anthropic_messages",
    label: "Anthropic 消息（Claude）",
    shortLabel: "Claude Messages",
    description: "适用于 Anthropic SDK、Claude Code 和兼容客户端",
    endpoint: `POST ${RELAY_BASE_PATH}/v1/messages`,
    authHeaders: [
      "x-api-key: <你的 API Key>",
      "anthropic-version: 2023-06-01",
    ],
  },
];

/** 新建渠道、编辑渠道和创建员工 Key 时允许选择的协议。 */
export const relayProtocolOptions: readonly RelayProtocolOption[] =
  relayProtocolDefinitions.filter((option) => option.value !== "openai_responses");

export function isRelayProtocol(value: unknown): value is RelayProtocol {
  return RELAY_PROTOCOLS.includes(value as RelayProtocol);
}

export function relayProtocolOption(protocol: RelayProtocol): RelayProtocolOption {
  return relayProtocolDefinitions.find((option) => option.value === protocol)!;
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
  if (protocol === "openai_responses") {
    return [
      `OPENAI_BASE_URL=${clientBaseUrl}`,
      `Codex provider base_url = "${clientBaseUrl}"`,
    ];
  }
  return [`OPENAI_BASE_URL=${clientBaseUrl}`];
}
