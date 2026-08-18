import {
  chatEndpoint,
  messagesEndpoint,
  SAMPLE_KEY,
  type DocField,
  type EndpointDoc,
  type HttpMethod,
  type LangId,
  type CodeSample,
} from "./spec";

export type NavEntry =
  { kind: "api"; doc: EndpointDoc } | { kind: "page"; id: "errors"; title: string };

export type NavGroup = { title: string; items: NavEntry[] };

const cookieAuth: DocField[] = [
  {
    name: "Cookie",
    type: "string",
    required: true,
    description: "登录接口下发的 `fabric_session`。缺失或过期返回 401 `unauthorized`。",
  },
];

const jsonHeader: DocField[] = [
  {
    name: "Content-Type",
    type: "string",
    required: true,
    defaultValue: "application/json",
    description: "请求体为 JSON。",
  },
];

function f(
  name: string,
  type: string,
  description: string,
  extra: Partial<DocField> = {},
): DocField {
  return { name, type, description, ...extra };
}

function rest(
  id: string,
  title: string,
  method: HttpMethod,
  path: string,
  summary: string,
  opts: {
    description?: string;
    adminOnly?: boolean;
    cookie?: boolean;
    headers?: DocField[];
    query?: DocField[];
    body?: DocField[];
    response: DocField[];
    exampleBody?: unknown;
    exampleResponse: unknown;
  },
): EndpointDoc {
  const cookie = opts.cookie !== false;
  return {
    id,
    title,
    method,
    path,
    summary,
    description:
      opts.description ?? (cookie ? "需要已登录的 `fabric_session` Cookie。" : "无需鉴权。"),
    adminOnly: opts.adminOnly,
    auth: cookie ? cookieAuth : [],
    headers: opts.headers ?? (method === "GET" || method === "DELETE" ? [] : jsonHeader),
    query: opts.query,
    body: opts.body ?? [],
    response: opts.response,
    exampleBody: opts.exampleBody,
    exampleResponse: opts.exampleResponse,
    cookie,
  };
}

const projectFields: DocField[] = [f("name", "string", "Project 名称，唯一。")];

const vkPublicFields: DocField[] = [
  f("hash", "string", "虚拟钥匙的 SHA-256 hex，列表与查询只回这个。"),
  f("project", "string", "所属 Project。"),
  f("disabled", "boolean", "停用后网关返回 `invalid_virtual_key`。"),
];

const providerFields: DocField[] = [
  f("name", "string", "Provider 名称，唯一。"),
  f("family", "enum<string>", "`openai` 或 `anthropic`。"),
  f("base_url", "string", "上游根地址，不含路径。"),
  f("disabled", "boolean", "停用后挂在它下面的 Model 视为不可用。"),
];

const modelFields: DocField[] = [
  f("name", "string", "请求里的 model 名。"),
  f("family", "enum<string>", "`openai` 或 `anthropic`，须与 Provider 一致。"),
  f("provider", "string", "绑定的 Provider 名。"),
  f("disabled", "boolean", "停用后网关返回 `unknown_model`。"),
];

const priceFields: DocField[] = [
  f("model", "string", "对应已登记的 model。"),
  f("input_cny", "number", "每百万 input Token 的人民币成本价。"),
  f("output_cny", "number", "每百万 output Token 的人民币成本价。"),
  f("cached_cny", "number", "每百万 cached Token 的人民币成本价。"),
];

const health = rest("health", "健康检查", "GET", "/health", "网关存活探测。", {
  cookie: false,
  description: "进程健康检查。不探测数据库。无需鉴权。",
  response: [f("ok", "boolean", "进程起来即为 true。"), f("service", "string", "固定 `fabric`。")],
  exampleResponse: { ok: true, service: "fabric" },
});

const login = rest("login", "登录", "POST", "/admin/api/login", "用户名 + 密码换 Session。", {
  cookie: false,
  description: "校验通过后写 HttpOnly Cookie `fabric_session`。种子账号 `admin` / `Hz@123456`。",
  body: [
    f("username", "string", "管理员用户名。", { required: true }),
    f("password", "string", "密码。", { required: true }),
  ],
  response: [f("status", "string", "固定 `ok`。"), f("username", "string", "登录用户名。")],
  exampleBody: { username: "admin", password: "Hz@123456" },
  exampleResponse: { status: "ok", username: "admin" },
});

const logout = rest("logout", "退出", "POST", "/admin/api/logout", "吊销当前 Session。", {
  cookie: false,
  description: "清除 `fabric_session`。没有 Cookie 也返回成功。",
  headers: [],
  response: [f("status", "string", "固定 `ok`。")],
  exampleResponse: { status: "ok" },
});

const me = rest("me", "当前用户", "GET", "/admin/api/me", "读取登录身份。", {
  response: [
    f("username", "string", "登录用户名。"),
    f("name", "string", "当前等于 username。"),
    f("role", "string", "固定 `admin`。"),
  ],
  exampleResponse: { username: "admin", name: "admin", role: "admin" },
});

const listProjects = rest(
  "list-projects",
  "项目列表",
  "GET",
  "/admin/api/projects",
  "列出全部 Project。",
  {
    response: [f("projects", "object[]", "项目数组。", { children: projectFields })],
    exampleResponse: { projects: [{ name: "demo" }] },
  },
);

const createProject = rest(
  "create-project",
  "创建项目",
  "POST",
  "/admin/api/projects",
  "新建 Project。",
  {
    body: [f("name", "string", "项目名，不能为空。", { required: true })],
    response: projectFields,
    exampleBody: { name: "billing" },
    exampleResponse: { name: "billing" },
  },
);

const listVKs = rest(
  "list-virtual-keys",
  "虚拟钥匙列表",
  "GET",
  "/admin/api/virtual-keys",
  "列出全部 VK 元数据，不含明文。",
  {
    response: [f("keys", "object[]", "不含明文。", { children: vkPublicFields })],
    exampleResponse: {
      keys: [
        {
          hash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
          project: "demo",
          disabled: false,
        },
      ],
    },
  },
);

const createVK = rest(
  "create-virtual-key",
  "发放虚拟钥匙",
  "POST",
  "/admin/api/virtual-keys",
  "为已有 Project 发一把 VK。明文只在这次响应里出现。",
  {
    body: [f("project", "string", "已存在的 Project 名。", { required: true })],
    response: [...vkPublicFields, f("plaintext", "string", "明文，前缀 `sk-fab-`，只此一次。")],
    exampleBody: { project: "demo" },
    exampleResponse: {
      hash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      project: "demo",
      disabled: false,
      plaintext: SAMPLE_KEY,
    },
  },
);

const getVK = rest(
  "get-virtual-key",
  "虚拟钥匙详情",
  "GET",
  "/admin/api/virtual-keys/{hash}",
  "按 hash 读一把 VK，不含明文。",
  {
    response: vkPublicFields,
    exampleResponse: {
      hash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      project: "demo",
      disabled: false,
    },
  },
);

const disableVK = rest(
  "disable-virtual-key",
  "停用虚拟钥匙",
  "POST",
  "/admin/api/virtual-keys/{hash}/disable",
  "停用后该明文再打网关会 401。",
  {
    headers: [],
    response: [f("status", "string", "固定 `disabled`。")],
    exampleResponse: { status: "disabled" },
  },
);

const listProviders = rest(
  "list-providers",
  "Provider 列表",
  "GET",
  "/admin/api/providers",
  "列出上游 Provider 元数据，不含官方 Key。",
  {
    response: [f("providers", "object[]", "不含 api_key。", { children: providerFields })],
    exampleResponse: {
      providers: [
        {
          name: "deepseek",
          family: "openai",
          base_url: "https://api.deepseek.com",
          disabled: false,
        },
      ],
    },
  },
);

const createProvider = rest(
  "create-provider",
  "录入 Provider",
  "POST",
  "/admin/api/providers",
  "加密入库一把官方 Key。明文只在请求里出现一次。",
  {
    description: "需要已登录 Session。`api_key` 用 AES-GCM 加密后入库，响应永不回 secret。",
    body: [
      f("name", "string", "名称，唯一。", { required: true }),
      f("family", "enum<string>", "`openai` 或 `anthropic`。", { required: true }),
      f("base_url", "string", "上游根地址。", { required: true }),
      f("api_key", "string", "官方 Key 明文。", { required: true }),
    ],
    response: providerFields,
    exampleBody: {
      name: "deepseek",
      family: "openai",
      base_url: "https://api.deepseek.com",
      api_key: "sk-upstream-secret",
    },
    exampleResponse: {
      name: "deepseek",
      family: "openai",
      base_url: "https://api.deepseek.com",
      disabled: false,
    },
  },
);

const getProvider = rest(
  "get-provider",
  "Provider 详情",
  "GET",
  "/admin/api/providers/{name}",
  "按名称读取，不含官方 Key。",
  {
    response: providerFields,
    exampleResponse: {
      name: "deepseek",
      family: "openai",
      base_url: "https://api.deepseek.com",
      disabled: false,
    },
  },
);

const disableProvider = rest(
  "disable-provider",
  "停用 Provider",
  "POST",
  "/admin/api/providers/{name}/disable",
  "停用后挂在它下面的 Model 视为 `unknown_model`。",
  {
    headers: [],
    response: [f("status", "string", "固定 `disabled`。")],
    exampleResponse: { status: "disabled" },
  },
);

const listModels = rest(
  "list-models",
  "Model 列表",
  "GET",
  "/admin/api/models",
  "列出全部 Model 映射。",
  {
    response: [f("models", "object[]", "模型映射。", { children: modelFields })],
    exampleResponse: {
      models: [{ name: "gpt-4o-mini", family: "openai", provider: "deepseek", disabled: false }],
    },
  },
);

const createModel = rest(
  "create-model",
  "登记 Model",
  "POST",
  "/admin/api/models",
  "把请求 model 绑到一个已有 Provider。",
  {
    body: [
      f("name", "string", "请求里的 model 名。", { required: true }),
      f("family", "enum<string>", "须与 Provider 的 family 一致。", { required: true }),
      f("provider", "string", "已存在的 Provider 名。", { required: true }),
    ],
    response: [
      f("name", "string", "模型名。"),
      f("family", "string", "协议族。"),
      f("provider", "string", "Provider。"),
    ],
    exampleBody: { name: "gpt-4o-mini", family: "openai", provider: "deepseek" },
    exampleResponse: { name: "gpt-4o-mini", family: "openai", provider: "deepseek" },
  },
);

const disableModel = rest(
  "disable-model",
  "停用 Model",
  "POST",
  "/admin/api/models/{name}/disable",
  "停用后网关对该 model 返回 `unknown_model`。",
  {
    headers: [],
    response: [f("status", "string", "固定 `disabled`。")],
    exampleResponse: { status: "disabled" },
  },
);

const listPrices = rest("list-prices", "价格列表", "GET", "/admin/api/prices", "列出全部成本价。", {
  response: [f("prices", "object[]", "按百万 Token 计的人民币价。", { children: priceFields })],
  exampleResponse: {
    prices: [{ model: "gpt-4o-mini", input_cny: 1, output_cny: 2, cached_cny: 0.1 }],
  },
});

const upsertPrice = rest(
  "upsert-price",
  "写入价格",
  "PUT",
  "/admin/api/prices/{model}",
  "为已登记 Model 写入或覆盖成本价。",
  {
    body: [
      f("input_cny", "number", "每百万 input Token，人民币。", { required: true }),
      f("output_cny", "number", "每百万 output Token，人民币。", { required: true }),
      f("cached_cny", "number", "每百万 cached Token，人民币。", { required: true }),
    ],
    response: priceFields,
    exampleBody: { input_cny: 1, output_cny: 2, cached_cny: 0.1 },
    exampleResponse: { model: "gpt-4o-mini", input_cny: 1, output_cny: 2, cached_cny: 0.1 },
  },
);

const deletePrice = rest(
  "delete-price",
  "删除价格",
  "DELETE",
  "/admin/api/prices/{model}",
  "删掉后该 model 再打网关会 400 `no_price`。",
  {
    headers: [],
    response: [f("status", "string", "固定 `deleted`。")],
    exampleResponse: { status: "deleted" },
  },
);

const usage = rest(
  "usage",
  "用量聚合",
  "GET",
  "/admin/api/usage",
  "按 Project × Model × 日聚合。日界为 Asia/Shanghai。",
  {
    query: [
      f("day", "string", "YYYY-MM-DD。缺省为上海时区今天。"),
      f("project", "string", "按 Project 过滤。空则全部。"),
    ],
    response: [
      f("day", "string", "查询的日。"),
      f("project", "string", "查询的 Project 过滤，空为全部。"),
      f("rows", "object[]", "聚合行。", {
        children: [
          f("project", "string", "Project。"),
          f("model", "string", "Model。"),
          f("day", "string", "上海时区日。"),
          f("calls", "integer", "总调用。"),
          f("failed_calls", "integer", "HTTP 失败。"),
          f("zero_usage_calls", "integer", "上游没回 usage 的次数。"),
          f("input_tokens", "integer", "输入 Token。"),
          f("output_tokens", "integer", "输出 Token。"),
          f("cached_tokens", "integer", "缓存 Token。"),
          f("cost_cny", "number", "按价格表算出的人民币成本。"),
        ],
      }),
    ],
    exampleResponse: {
      project: "",
      day: "2026-08-18",
      rows: [
        {
          project: "demo",
          model: "gpt-4o-mini",
          day: "2026-08-18",
          calls: 3,
          failed_calls: 0,
          zero_usage_calls: 0,
          input_tokens: 84,
          output_tokens: 126,
          cached_tokens: 0,
          cost_cny: 0.000336,
        },
      ],
    },
  },
);

const requests = rest(
  "requests",
  "请求流水",
  "GET",
  "/admin/api/requests",
  "列出某 Project 的请求流水（账本粒度）。",
  {
    query: [f("project", "string", "Project 名。缺省为种子项目 `demo`。")],
    response: [
      f("project", "string", "查询的 Project。"),
      f("requests", "object[]", "流水。", {
        children: [
          f("virtual_key_hash", "string", "VK 哈希。"),
          f("project", "string", "Project。"),
          f("model", "string", "请求 model。"),
          f("input_tokens", "integer", "输入。"),
          f("output_tokens", "integer", "输出。"),
          f("cached_tokens", "integer", "缓存。"),
          f("cost_cny", "number", "本次成本。"),
          f("status", "integer", "回给调用方的 HTTP 状态。"),
          f("latency_ms", "integer", "从进网关到写出响应的墙钟毫秒，含上游等待。"),
          f("run_id", "string", "来自 `x-fabric-context.run_id`，未传则为空。"),
          f("task_type", "string", "来自 `x-fabric-context.task_type`。"),
          f("created_at", "string", "入账时刻，RFC3339。报表按此时刻切 Asia/Shanghai 日。"),
        ],
      }),
    ],
    exampleResponse: {
      project: "demo",
      requests: [
        {
          virtual_key_hash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
          project: "demo",
          model: "gpt-4o-mini",
          input_tokens: 28,
          output_tokens: 42,
          cached_tokens: 0,
          cost_cny: 0.000112,
          status: 200,
          latency_ms: 312,
          run_id: "run-1",
          task_type: "chat",
          created_at: "2026-08-18T10:00:00+08:00",
        },
      ],
    },
  },
);

export const navGroups: NavGroup[] = [
  {
    title: "模型 API",
    items: [
      { kind: "api", doc: chatEndpoint },
      { kind: "api", doc: messagesEndpoint },
    ],
  },
  {
    title: "系统",
    items: [{ kind: "api", doc: health }],
  },
  {
    title: "账号",
    items: [
      { kind: "api", doc: login },
      { kind: "api", doc: logout },
      { kind: "api", doc: me },
    ],
  },
  {
    title: "项目",
    items: [
      { kind: "api", doc: listProjects },
      { kind: "api", doc: createProject },
    ],
  },
  {
    title: "虚拟钥匙",
    items: [
      { kind: "api", doc: listVKs },
      { kind: "api", doc: createVK },
      { kind: "api", doc: getVK },
      { kind: "api", doc: disableVK },
    ],
  },
  {
    title: "上游 Provider",
    items: [
      { kind: "api", doc: listProviders },
      { kind: "api", doc: createProvider },
      { kind: "api", doc: getProvider },
      { kind: "api", doc: disableProvider },
    ],
  },
  {
    title: "Model 映射",
    items: [
      { kind: "api", doc: listModels },
      { kind: "api", doc: createModel },
      { kind: "api", doc: disableModel },
    ],
  },
  {
    title: "价格与用量",
    items: [
      { kind: "api", doc: listPrices },
      { kind: "api", doc: upsertPrice },
      { kind: "api", doc: deletePrice },
      { kind: "api", doc: usage },
      { kind: "api", doc: requests },
    ],
  },
  {
    title: "参考",
    items: [{ kind: "page", id: "errors", title: "鉴权与错误" }],
  },
];

export const allEndpoints: EndpointDoc[] = navGroups.flatMap((g) =>
  g.items.filter((i): i is { kind: "api"; doc: EndpointDoc } => i.kind === "api").map((i) => i.doc),
);

export function findEndpoint(id: string): EndpointDoc | undefined {
  return allEndpoints.find((e) => e.id === id);
}

export const DEFAULT_API = "chat";

export function restSamples(ep: EndpointDoc, origin: string): Record<LangId, CodeSample> {
  const base = origin.replace(/\/$/, "");
  const path = ep.path
    .replace("{hash}", "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08")
    .replace("{name}", "deepseek")
    .replace("{model}", "gpt-4o-mini");
  const url = `${base}${path}`;
  const body = ep.exampleBody ? JSON.stringify(ep.exampleBody, null, 2) : "";
  const response = JSON.stringify(ep.exampleResponse ?? {}, null, 2);
  const cookie = ep.cookie ? " --cookie 'fabric_session=…'" : "";
  const contentType =
    ep.method !== "GET" && ep.method !== "DELETE" && body
      ? " --header 'Content-Type: application/json'"
      : "";
  const data = body ? ` --data '\n${body}\n'` : "";
  const curl = `curl --request ${ep.method} \\\n  --url ${url}${cookie}${contentType}${data}`;

  const headers: Record<string, string> = {};
  if (ep.cookie) headers.Cookie = "fabric_session=…";
  if (ep.method !== "GET" && ep.method !== "DELETE" && body)
    headers["Content-Type"] = "application/json";
  const headerLit = JSON.stringify(headers, null, 2);
  const fetchOpts = [
    `  method: "${ep.method}"`,
    `  headers: ${headerLit.replace(/\n/g, "\n  ")}`,
    body ? `  body: JSON.stringify(${body})` : "",
  ]
    .filter(Boolean)
    .join(",\n");

  return {
    curl: { request: curl, response },
    python: {
      request: `import requests

resp = requests.request(
    "${ep.method}",
    "${url}",
    ${ep.cookie ? 'cookies={"fabric_session": "…"},\n    ' : ""}${body ? `json=${body},\n    ` : ""}
)
print(resp.json())`,
      response,
    },
    javascript: {
      request: `const resp = await fetch("${url}", {
${fetchOpts}
});
console.log(await resp.json());`,
      response,
    },
  };
}
