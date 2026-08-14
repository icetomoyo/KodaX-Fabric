export type DocField = {
  name: string;
  type: string;
  required?: boolean;
  defaultValue?: string;
  description: string;
  children?: DocField[];
};

export type LangId = "curl" | "python" | "javascript";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT";

export type EndpointId = string;

export type CodeSample = {
  request: string;
  response: string;
};

export type EndpointDoc = {
  id: EndpointId;
  title: string;
  protocol?: string;
  method: HttpMethod;
  path: string;
  summary: string;
  description: string;
  adminOnly?: boolean;
  auth: DocField[];
  headers: DocField[];
  query?: DocField[];
  body: DocField[];
  response: DocField[];
  fabricHeaders?: DocField[];
  exampleBody?: unknown;
  exampleResponse?: unknown;
  cookie?: boolean;
};

export const LANGS: { id: LangId; label: string }[] = [
  { id: "curl", label: "cURL" },
  { id: "python", label: "Python" },
  { id: "javascript", label: "JavaScript" },
];

export const SAMPLE_KEY = "fab-xxxxxxxx";

const chatSuccess = `{
  "id": "chatcmpl-01",
  "object": "chat.completion",
  "created": 1710000000,
  "model": "gpt-4",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "def fib(n):\\n    a, b = 0, 1\\n    for _ in range(n):\\n        a, b = b, a + b\\n    return a"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 28,
    "completion_tokens": 42,
    "total_tokens": 70
  }
}`;

const messagesSuccess = `{
  "id": "msg_01",
  "type": "message",
  "role": "assistant",
  "model": "claude-sonnet-4-0",
  "content": [
    {
      "type": "text",
      "text": "def fib(n):\\n    a, b = 0, 1\\n    for _ in range(n):\\n        a, b = b, a + b\\n    return a"
    }
  ],
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 24,
    "output_tokens": 40
  }
}`;

export const chatEndpoint: EndpointDoc = {
  id: "chat",
  title: "对话补全",
  protocol: "OpenAI Chat Completions",
  method: "POST",
  path: "/v1/chat/completions",
  summary: "OpenAI 兼容对话补全。网关原样转发请求体，不改写 messages / tools / thinking。",
  description:
    "调用方只持虚拟钥匙（`fab-`）。网关按 VK 绑的池选一条 OpenAI 兼容渠，把请求透传到上游。同一把 VK 也可以打 `/v1/messages`，但两个端点互不转换、不跨协议换路。",
  auth: [
    {
      name: "Authorization",
      type: "string",
      required: true,
      description:
        "标准 HTTP Bearer。值为虚拟钥匙明文，例如 `Bearer fab-xxxxxxxx`。也可用请求头 `X-Api-Key` 直接传同一把钥匙。钥匙必须是 `fab-` 前缀；过期或无效返回 401。",
    },
  ],
  headers: [
    {
      name: "Content-Type",
      type: "string",
      required: true,
      defaultValue: "application/json",
      description: "请求体为 JSON。",
    },
    {
      name: "X-Api-Key",
      type: "string",
      description: "与 `Authorization: Bearer` 二选一。若同时存在，优先读 `X-Api-Key`。",
    },
    {
      name: "X-Fabric-Cacheable",
      type: "string",
      description:
        "设为 `true` 或 `1` 时，非流式且相同协议 + 模型 + 规范化请求体可命中响应缓存。`stream: true` 永不缓存。",
    },
  ],
  body: [
    {
      name: "model",
      type: "string",
      required: true,
      description:
        "调用的模型名。网关用它做 VK `model_scope` 校验、选渠和模型别名 fallback。不在白名单或缺省时返回 403 `model_not_allowed`。别名命中后只改写出站 `model`，不换协议。",
    },
    {
      name: "messages",
      type: "object[]",
      required: true,
      description:
        "对话上下文，按时间顺序。网关不解析、不改写，原样交给上游。至少一条；不能只发 system。角色与内容遵循上游 OpenAI 兼容约定。",
      children: [
        {
          name: "role",
          type: "enum<string>",
          required: true,
          description:
            "`system` 设定行为，`user` 用户输入，`assistant` 模型回复，`tool` 工具结果。",
        },
        {
          name: "content",
          type: "string | object[]",
          required: true,
          description: "文本，或上游支持的多模态内容块。网关透传。",
        },
        {
          name: "name",
          type: "string",
          description: "可选。参与者名称，部分上游用于区分多用户。",
        },
        {
          name: "tool_calls",
          type: "object[]",
          description: "助手消息里的工具调用。网关不翻译协议。",
        },
      ],
    },
    {
      name: "stream",
      type: "boolean",
      defaultValue: "false",
      description:
        "`false`：等完整响应一次返回。`true`：按上游 SSE 原样流式写出，客户端断开即停上游。流式结束常见 `data: [DONE]`。流式响应不进缓存。",
    },
    {
      name: "temperature",
      type: "number",
      description:
        "采样温度，透传给上游。取值与默认值以上游模型为准。不要和 `top_p` 同时大幅调整。",
    },
    {
      name: "top_p",
      type: "number",
      description: "核采样，透传给上游。建议与 `temperature` 二选一调节。",
    },
    {
      name: "max_tokens",
      type: "integer",
      description: "生成上限。部分上游用 `max_completion_tokens`。网关原样转发字段名。",
    },
    {
      name: "tools",
      type: "object[]",
      description: "函数 / 工具定义，透传。不要指望网关把 OpenAI tools 翻成 Anthropic tools。",
    },
    {
      name: "tool_choice",
      type: "string | object",
      description: "工具选择策略（如 `auto` / `none` / 指定函数），透传。",
    },
    {
      name: "stop",
      type: "string | string[]",
      description: "停止词，透传。",
    },
    {
      name: "response_format",
      type: "object",
      description: '如 `{ "type": "json_object" }`。是否生效取决于上游模型。',
    },
    {
      name: "fabric_context",
      type: "object",
      description: "可选。网关只认其中的 `cacheable`。其余字段当前忽略，不会送到上游鉴权。",
      children: [
        {
          name: "cacheable",
          type: "boolean",
          description: "与请求头 `X-Fabric-Cacheable` 等效。仅非流式生效。",
        },
      ],
    },
  ],
  response: [
    {
      name: "id",
      type: "string",
      description: "上游补全 ID，网关不改写。",
    },
    {
      name: "model",
      type: "string",
      description: "实际上游使用的模型。若触发模型别名，可能与请求 `model` 不同。",
    },
    {
      name: "choices",
      type: "object[]",
      description: "补全结果。结构与上游一致。",
      children: [
        {
          name: "index",
          type: "integer",
          description: "候选项序号。",
        },
        {
          name: "message",
          type: "object",
          description: "`role` + `content`，以及上游可能返回的 `tool_calls` / `reasoning` 等字段。",
        },
        {
          name: "finish_reason",
          type: "string",
          description: "如 `stop`、`length`、`tool_calls`。",
        },
      ],
    },
    {
      name: "usage",
      type: "object",
      description:
        "厂家 Token 用量。网关用 `total_tokens`，或 `prompt_tokens + completion_tokens` 记入 VK 月预算。没有 usage 才回退估算。",
      children: [
        { name: "prompt_tokens", type: "integer", description: "输入 Token。" },
        { name: "completion_tokens", type: "integer", description: "输出 Token。" },
        { name: "total_tokens", type: "integer", description: "合计。" },
      ],
    },
  ],
  fabricHeaders: fabricResponseHeaders(),
};

export const messagesEndpoint: EndpointDoc = {
  id: "messages",
  title: "Messages",
  protocol: "Anthropic Messages",
  method: "POST",
  path: "/v1/messages",
  summary: "Anthropic 兼容消息接口。网关原样转发，不把 OpenAI 请求翻译过来。",
  description:
    "用同一把 `fab-` 虚拟钥匙。Claude Code / Anthropic SDK 的 Base URL 填网关根地址（不要带 `/v1`），SDK 会请求 `/v1/messages`。网关出站时用池内渠的官方 Key，并补 `Anthropic-Version`。",
  auth: [
    {
      name: "x-api-key",
      type: "string",
      required: true,
      description:
        "虚拟钥匙明文，例如 `fab-xxxxxxxx`。也可用 `Authorization: Bearer fab-xxxxxxxx`。`X-Api-Key` 优先。",
    },
  ],
  headers: [
    {
      name: "Content-Type",
      type: "string",
      required: true,
      defaultValue: "application/json",
      description: "请求体为 JSON。",
    },
    {
      name: "anthropic-version",
      type: "string",
      description:
        "调用方可带。网关打上游时会自行设置 `Anthropic-Version: 2023-06-01`，不依赖调用方这把官方 Key。",
    },
    {
      name: "X-Fabric-Cacheable",
      type: "string",
      description: "与对话补全相同。仅非流式可缓存。",
    },
  ],
  body: [
    {
      name: "model",
      type: "string",
      required: true,
      description: "Anthropic 模型名。同样走 VK 模型白名单、选渠和同协议别名。",
    },
    {
      name: "max_tokens",
      type: "integer",
      required: true,
      description: "Anthropic 协议必填的输出上限。网关透传，不代填。",
    },
    {
      name: "messages",
      type: "object[]",
      required: true,
      description:
        "轮次消息。角色通常是 `user` / `assistant`。系统提示请放 `system`，不要只塞一条 system 当 messages。",
      children: [
        {
          name: "role",
          type: "enum<string>",
          required: true,
          description: "`user` 或 `assistant`。",
        },
        {
          name: "content",
          type: "string | object[]",
          required: true,
          description: "文本或内容块数组，透传。",
        },
      ],
    },
    {
      name: "system",
      type: "string | object[]",
      description: "系统提示，透传。",
    },
    {
      name: "stream",
      type: "boolean",
      defaultValue: "false",
      description: "SSE 透传。断开客户端即停上游。流式不缓存。",
    },
    {
      name: "temperature",
      type: "number",
      description: "透传给上游。",
    },
    {
      name: "top_p",
      type: "number",
      description: "透传给上游。",
    },
    {
      name: "tools",
      type: "object[]",
      description: "Anthropic 工具定义，透传。不要发 OpenAI 形态的 tools。",
    },
    {
      name: "fabric_context",
      type: "object",
      description: "可选。仅 `cacheable` 对网关有意义。",
    },
  ],
  response: [
    {
      name: "id",
      type: "string",
      description: "上游消息 ID。",
    },
    {
      name: "type",
      type: "string",
      description: "一般为 `message`。",
    },
    {
      name: "role",
      type: "string",
      description: "`assistant`。",
    },
    {
      name: "content",
      type: "object[]",
      description: '内容块，常见 `{ "type": "text", "text": "..." }`。',
    },
    {
      name: "stop_reason",
      type: "string",
      description: "如 `end_turn`、`max_tokens`、`tool_use`。",
    },
    {
      name: "usage",
      type: "object",
      description: "网关用 `input_tokens + output_tokens` 记预算（当没有 `total_tokens` 时）。",
      children: [
        { name: "input_tokens", type: "integer", description: "输入 Token。" },
        { name: "output_tokens", type: "integer", description: "输出 Token。" },
      ],
    },
  ],
  fabricHeaders: fabricResponseHeaders(),
};

export type FabricError = {
  status: number;
  code: string;
  when: string;
  openai: string;
  anthropic: string;
};

export const fabricErrors: FabricError[] = [
  {
    status: 401,
    code: "invalid_api_key",
    when: "缺少钥匙、不是 `fab-` 前缀、哈希对不上，或 VK 已过期。",
    openai: `{"error":{"message":"invalid virtual key","type":"invalid_request_error","code":"invalid_api_key"}}`,
    anthropic: `{"type":"error","error":{"type":"authentication_error","message":"invalid virtual key"}}`,
  },
  {
    status: 403,
    code: "model_not_allowed",
    when: "请求 `model` 不在该 VK 的 `model_scope`，或没传 model。",
    openai: `{"error":{"message":"model not allowed","type":"invalid_request_error","code":"model_not_allowed"}}`,
    anthropic: `{"type":"error","error":{"type":"permission_error","message":"model not allowed"}}`,
  },
  {
    status: 403,
    code: "forbidden",
    when: "调用方 IP 不在该 VK 的白名单。",
    openai: `{"error":{"message":"ip not allowed","type":"invalid_request_error","code":"forbidden"}}`,
    anthropic: `{"type":"error","error":{"type":"permission_error","message":"ip not allowed"}}`,
  },
  {
    status: 402,
    code: "budget_exceeded",
    when: "VK 月预算已用尽（硬闸）。接近额度时仍放行，但会带预算告警头。",
    openai: `{"error":{"message":"budget exceeded","type":"billing_error","code":"budget_exceeded"}}`,
    anthropic: `{"type":"error","error":{"type":"billing_error","message":"budget exceeded"}}`,
  },
  {
    status: 429,
    code: "rate_limited",
    when: "VK 或同 Provider 触达 RPM，或池内相关渠都因熔断不可用。",
    openai: `{"error":{"message":"rate limited","type":"rate_limit_error","code":"rate_limited"}}`,
    anthropic: `{"type":"error","error":{"type":"rate_limit_error","message":"rate limited"}}`,
  },
  {
    status: 502,
    code: "provider_error",
    when: "已选渠但出站请求失败（非流式）。",
    openai: `{"error":{"message":"upstream request failed","type":"server_error","code":"provider_error"}}`,
    anthropic: `{"error":{"message":"upstream request failed","type":"server_error","code":"provider_error"}}`,
  },
  {
    status: 503,
    code: "provider_unavailable",
    when: "池里没有匹配该协议 / 模型且可用的渠。",
    openai: `{"error":{"message":"no matching channel in pool","type":"server_error","code":"provider_unavailable"}}`,
    anthropic: `{"type":"error","error":{"type":"api_error","message":"no matching channel in pool"}}`,
  },
];

function fabricResponseHeaders(): DocField[] {
  return [
    {
      name: "X-Fabric-Request-Id",
      type: "string",
      description: "本次请求追踪 ID，对应路由审计里的 `request_id`。",
    },
    {
      name: "X-Fabric-Route",
      type: "string",
      description:
        "选路摘要，形如 `channel=3;reason=priority`。`reason` 可能是 `priority` / `weighted` / `failover` / `model_fallback`。",
    },
    {
      name: "X-Fabric-Fallback",
      type: "boolean",
      description: "是否发生换路或模型别名 fallback。",
    },
    {
      name: "X-Fabric-Pool-Group",
      type: "string",
      description: "池分组：`premium` / `standard` / `bulk`。",
    },
    {
      name: "X-Fabric-Cache",
      type: "string",
      description: "可缓存请求上出现：`hit` 或 `miss`。",
    },
    {
      name: "X-Fabric-Budget-Warn",
      type: "string",
      description: "月用量达到预算 80% 且未用尽时为 `true`。",
    },
    {
      name: "X-Fabric-Budget-Used",
      type: "string",
      description: "告警时附带，形如 `8000/10000`。",
    },
  ];
}

export function samplesFor(id: EndpointId, origin: string): Record<LangId, CodeSample> {
  const base = origin.replace(/\/$/, "");
  if (id === "messages") return messagesSamples(base);
  return chatSamples(base);
}

function chatSamples(origin: string): Record<LangId, CodeSample> {
  const url = `${origin}/v1/chat/completions`;
  const body = `{
  "model": "gpt-4",
  "messages": [
    {
      "role": "system",
      "content": "你是编程助手，擅长写简洁高效的代码。"
    },
    {
      "role": "user",
      "content": "写一个 Python 函数，计算斐波那契数列第 n 项。"
    }
  ],
  "temperature": 1,
  "stream": false
}`;
  return {
    curl: {
      request: `curl --request POST \\
  --url ${url} \\
  --header 'Authorization: Bearer ${SAMPLE_KEY}' \\
  --header 'Content-Type: application/json' \\
  --data '
${body}
'`,
      response: chatSuccess,
    },
    python: {
      request: `from openai import OpenAI

client = OpenAI(
    api_key="${SAMPLE_KEY}",
    base_url="${origin}/v1",
)

resp = client.chat.completions.create(
    model="gpt-4",
    messages=[
        {"role": "system", "content": "你是编程助手，擅长写简洁高效的代码。"},
        {"role": "user", "content": "写一个 Python 函数，计算斐波那契数列第 n 项。"},
    ],
    temperature=1,
    stream=False,
)
print(resp.choices[0].message.content)`,
      response: chatSuccess,
    },
    javascript: {
      request: `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "${SAMPLE_KEY}",
  baseURL: "${origin}/v1",
});

const resp = await client.chat.completions.create({
  model: "gpt-4",
  messages: [
    { role: "system", content: "你是编程助手，擅长写简洁高效的代码。" },
    { role: "user", content: "写一个 Python 函数，计算斐波那契数列第 n 项。" },
  ],
  temperature: 1,
  stream: false,
});
console.log(resp.choices[0].message.content);`,
      response: chatSuccess,
    },
  };
}

function messagesSamples(origin: string): Record<LangId, CodeSample> {
  const url = `${origin}/v1/messages`;
  const body = `{
  "model": "claude-sonnet-4-0",
  "max_tokens": 1024,
  "messages": [
    {
      "role": "user",
      "content": "写一个 Python 函数，计算斐波那契数列第 n 项。"
    }
  ],
  "stream": false
}`;
  return {
    curl: {
      request: `curl --request POST \\
  --url ${url} \\
  --header 'x-api-key: ${SAMPLE_KEY}' \\
  --header 'Content-Type: application/json' \\
  --data '
${body}
'`,
      response: messagesSuccess,
    },
    python: {
      request: `import anthropic

client = anthropic.Anthropic(
    api_key="${SAMPLE_KEY}",
    base_url="${origin}",
)

msg = client.messages.create(
    model="claude-sonnet-4-0",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": "写一个 Python 函数，计算斐波那契数列第 n 项。"},
    ],
)
print(msg.content[0].text)`,
      response: messagesSuccess,
    },
    javascript: {
      request: `import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: "${SAMPLE_KEY}",
  baseURL: "${origin}",
});

const msg = await client.messages.create({
  model: "claude-sonnet-4-0",
  max_tokens: 1024,
  messages: [
    { role: "user", content: "写一个 Python 函数，计算斐波那契数列第 n 项。" },
  ],
});
console.log(msg.content[0].text);`,
      response: messagesSuccess,
    },
  };
}
