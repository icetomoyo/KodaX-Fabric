export type DocField = {
  name: string;
  type: string;
  required?: boolean;
  defaultValue?: string;
  description: string;
  children?: DocField[];
};

export type LangId = "curl" | "python" | "javascript";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

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
  exampleBody?: unknown;
  exampleResponse?: unknown;
  cookie?: boolean;
};

export const LANGS: { id: LangId; label: string }[] = [
  { id: "curl", label: "cURL" },
  { id: "python", label: "Python" },
  { id: "javascript", label: "JavaScript" },
];

export const SAMPLE_KEY = "sk-fab-0123456789abcdef0123456789abcdef";

const chatSuccess = `{
  "id": "chatcmpl-01",
  "object": "chat.completion",
  "created": 1710000000,
  "model": "gpt-4o-mini",
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
  "model": "claude-haiku-4",
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
  summary: "OpenAI 兼容对话补全。网关原样转发请求体，只读 model / stream。",
  description:
    "调用方只持虚拟钥匙（发放为 `sk-fab-`，种子钥匙为 `sk-fabric-demo`）。网关按请求 `model` 查 Model 映射与价格，再把正文透传到对应 Provider。同一把 VK 也可以打 `/v1/messages`，但两个端点互不转换。",
  auth: [
    {
      name: "Authorization",
      type: "string",
      required: true,
      description:
        "标准 HTTP Bearer。值为虚拟钥匙明文，例如 `Bearer sk-fab-…`。也可用请求头 `x-api-key` 传同一把钥匙。缺钥匙返回 401 `missing_virtual_key`；哈希对不上或已停用返回 401 `invalid_virtual_key`。",
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
      name: "x-api-key",
      type: "string",
      description: "与 `Authorization: Bearer` 二选一。若同时存在，优先读 Bearer。",
    },
    {
      name: "x-fabric-context",
      type: "string",
      description:
        "可选 JSON。网关只认 `project_id`、`task_type`、`run_id`。`project_id` 若填必须与 VK 所属 Project 一致，否则 400 `project_mismatch`。非法 JSON 返回 400 `bad_fabric_context`。`run_id` / `task_type` 写入请求流水，不送到上游。",
    },
  ],
  body: [
    {
      name: "model",
      type: "string",
      required: true,
      description:
        "调用的模型名。必须已在 Model 映射中、未停用、family 为 `openai`，且价格表有行。否则 400 `unknown_model` 或 `no_price`。缺字段或非法 JSON 返回 `missing_model`。",
    },
    {
      name: "messages",
      type: "object[]",
      required: true,
      description: "对话上下文。网关不解析、不改写，原样交给上游。",
      children: [
        {
          name: "role",
          type: "enum<string>",
          required: true,
          description: "`system` / `user` / `assistant` / `tool`。以上游约定为准。",
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
          description: "可选。参与者名称。",
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
        "`false`：等完整响应一次返回。`true`：按上游 SSE 原样流式写出，客户端断开即停上游。",
    },
    {
      name: "temperature",
      type: "number",
      description: "采样温度，透传给上游。",
    },
    {
      name: "top_p",
      type: "number",
      description: "核采样，透传给上游。",
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
      description: "实际上游使用的模型。",
    },
    {
      name: "choices",
      type: "object[]",
      description: "补全结果。结构与上游一致。",
      children: [
        { name: "index", type: "integer", description: "候选项序号。" },
        {
          name: "message",
          type: "object",
          description: "`role` + `content`，以及上游可能返回的 `tool_calls` 等字段。",
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
        "厂家 Token 用量。网关用 `prompt_tokens` / `completion_tokens`（或 Anthropic 的 `input_tokens` / `output_tokens`）记入请求流水并按价格表算 CNY。",
      children: [
        { name: "prompt_tokens", type: "integer", description: "输入 Token。" },
        { name: "completion_tokens", type: "integer", description: "输出 Token。" },
        { name: "total_tokens", type: "integer", description: "合计。网关记账不依赖此字段。" },
      ],
    },
  ],
};

export const messagesEndpoint: EndpointDoc = {
  id: "messages",
  title: "Messages",
  protocol: "Anthropic Messages",
  method: "POST",
  path: "/v1/messages",
  summary: "Anthropic 兼容消息接口。网关原样转发，不把 OpenAI 请求翻译过来。",
  description:
    "用同一把 `sk-fab-` 虚拟钥匙。Claude Code / Anthropic SDK 的 Base URL 填网关根地址（不要带 `/v1`），SDK 会请求 `/v1/messages`。`model` 必须映射到 family 为 `anthropic` 的 Provider。",
  auth: [
    {
      name: "x-api-key",
      type: "string",
      required: true,
      description:
        "虚拟钥匙明文，例如 `sk-fab-…`。也可用 `Authorization: Bearer sk-fab-…`。Bearer 优先。",
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
      description: "调用方可带。出站时由 Live Provider 补官方 Key 与协议头，不依赖调用方官方 Key。",
    },
    {
      name: "x-fabric-context",
      type: "string",
      description: "与对话补全相同。`project_id` / `task_type` / `run_id`。",
    },
  ],
  body: [
    {
      name: "model",
      type: "string",
      required: true,
      description: "Anthropic 模型名。必须已映射且 family 为 `anthropic`，并有价格。",
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
      description: "轮次消息。角色通常是 `user` / `assistant`。系统提示请放 `system`。",
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
      description: "SSE 透传。断开客户端即停上游。",
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
  ],
  response: [
    { name: "id", type: "string", description: "上游消息 ID。" },
    { name: "type", type: "string", description: "一般为 `message`。" },
    { name: "role", type: "string", description: "`assistant`。" },
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
      description: "网关用 `input_tokens` / `output_tokens` 记流水。",
      children: [
        { name: "input_tokens", type: "integer", description: "输入 Token。" },
        { name: "output_tokens", type: "integer", description: "输出 Token。" },
      ],
    },
  ],
};

export type FabricError = {
  status: number;
  code: string;
  when: string;
  sample: string;
};

export const fabricErrors: FabricError[] = [
  {
    status: 401,
    code: "missing_virtual_key",
    when: "请求没有 `Authorization: Bearer`，也没有 `x-api-key`。",
    sample: `{"error":"missing_virtual_key"}`,
  },
  {
    status: 401,
    code: "invalid_virtual_key",
    when: "钥匙哈希对不上，或对应 VK 已停用。",
    sample: `{"error":"invalid_virtual_key"}`,
  },
  {
    status: 400,
    code: "bad_fabric_context",
    when: "`x-fabric-context` 不是合法 JSON。",
    sample: `{"error":"bad_fabric_context"}`,
  },
  {
    status: 400,
    code: "project_mismatch",
    when: "`x-fabric-context.project_id` 与该 VK 所属 Project 不一致。",
    sample: `{"error":"project_mismatch"}`,
  },
  {
    status: 400,
    code: "missing_model",
    when: "请求体不是 JSON，或没有 `model`。",
    sample: `{"error":"missing_model"}`,
  },
  {
    status: 400,
    code: "unknown_model",
    when: "模型未登记、已停用、Provider 已停用，或 family 与端点不符（OpenAI 端点打了 Anthropic 模型）。",
    sample: `{"error":"unknown_model"}`,
  },
  {
    status: 400,
    code: "no_price",
    when: "模型已登记但价格表没有对应行。",
    sample: `{"error":"no_price"}`,
  },
  {
    status: 502,
    code: "provider",
    when: "出站请求失败（连不上上游或解密 Provider Key 失败）。上游自己的 4xx/5xx 会原样回传，不走这条。",
    sample: `{"error":"provider"}`,
  },
  {
    status: 401,
    code: "unauthorized",
    when: "控制台接口缺少或过期 `fabric_session` Cookie。",
    sample: `{"error":"unauthorized"}`,
  },
  {
    status: 401,
    code: "invalid_credentials",
    when: "登录用户名或密码不对。",
    sample: `{"error":"invalid_credentials"}`,
  },
  {
    status: 404,
    code: "not_found",
    when: "按 hash / name / model 找不到对象，或路径未注册。",
    sample: `{"error":"not_found"}`,
  },
  {
    status: 409,
    code: "duplicate",
    when: "创建 Provider 或 Model 时名称已存在。",
    sample: `{"error":"duplicate"}`,
  },
];

export function samplesFor(id: EndpointId, origin: string): Record<LangId, CodeSample> {
  const base = origin.replace(/\/$/, "");
  if (id === "messages") return messagesSamples(base);
  return chatSamples(base);
}

function chatSamples(origin: string): Record<LangId, CodeSample> {
  const url = `${origin}/v1/chat/completions`;
  const body = `{
  "model": "gpt-4o-mini",
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
    model="gpt-4o-mini",
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
  model: "gpt-4o-mini",
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
  "model": "claude-haiku-4",
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
    model="claude-haiku-4",
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
  model: "claude-haiku-4",
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
