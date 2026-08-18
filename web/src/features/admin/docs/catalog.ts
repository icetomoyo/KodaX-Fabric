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

const projectFields: DocField[] = [
  f("name", "string", "Team 名称，唯一。P1 接口仍叫 Project。"),
];

const enterpriseFields: DocField[] = [
  f("name", "string", "企业名称，创建后不可改、不可删。"),
  f("disabled", "boolean", "停用后该企业下 VK 立刻 403 `enterprise_disabled`。"),
];

const vkPublicFields: DocField[] = [
  f("hash", "string", "虚拟钥匙的 SHA-256 hex，列表与查询只回这个。"),
  f("project", "string", "所属 Team。字段名 `project` 为过渡。"),
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
    f("role", "string", "`super_admin` / `enterprise_admin` / `team_admin` / `developer`。"),
    f("enterprise", "string", "所属企业。超级管理员无此字段。"),
    f("teams", "string[]", "团队管理员/开发者加入的 Team。"),
  ],
  exampleResponse: { username: "admin", name: "admin", role: "super_admin", teams: [] },
});

const createUser = rest(
  "create-user",
  "创建用户",
  "POST",
  "/admin/api/users",
  "按角色创建 User。超级管理员创建企业管理员；企业管理员创建团队管理员和开发者。",
  {
    body: [
      f("username", "string", "登录名，唯一。", { required: true }),
      f("password", "string", "本地密码。响应永不回传。", { required: true }),
      f("role", "enum<string>", "`enterprise_admin` / `team_admin` / `developer`。", { required: true }),
      f("enterprise", "string", "企业名。超级管理员创建企业管理员时必填；企业管理员创建时用自己的企业。"),
    ],
    response: [
      f("username", "string", "登录名。"),
      f("role", "string", "角色。"),
      f("enterprise", "string", "所属企业。"),
    ],
    exampleBody: {
      username: "acme-boss",
      password: "secret-pass",
      role: "enterprise_admin",
      enterprise: "acme",
    },
    exampleResponse: { username: "acme-boss", name: "acme-boss", role: "enterprise_admin", enterprise: "acme" },
  },
);

const addMember = rest(
  "add-member",
  "加入 Team",
  "POST",
  "/admin/api/teams/{name}/members",
  "企业管理员可派团队管理员/开发者；团队管理员只能加本 Team 的开发者。",
  {
    body: [f("username", "string", "已存在的 User。", { required: true })],
    response: [f("username", "string", "成员。"), f("team", "string", "Team 名。")],
    exampleBody: { username: "acme-dev" },
    exampleResponse: { username: "acme-dev", team: "billing" },
  },
);

const removeMember = rest(
  "remove-member",
  "撤出 Team",
  "DELETE",
  "/admin/api/teams/{name}/members/{username}",
  "撤掉后立刻看不见该 Team；已发 VK 仍能打。",
  {
    headers: [],
    response: [f("status", "string", "固定 `ok`。")],
    exampleResponse: { status: "ok" },
  },
);

const listEnterprises = rest(
  "list-enterprises",
  "企业列表",
  "GET",
  "/admin/api/enterprises",
  "列出全部企业。",
  {
    response: [f("enterprises", "object[]", "企业数组。", { children: enterpriseFields })],
    exampleResponse: {
      enterprises: [
        { name: "seed", disabled: false },
        { name: "acme", disabled: false },
      ],
    },
  },
);

const createEnterprise = rest(
  "create-enterprise",
  "创建企业",
  "POST",
  "/admin/api/enterprises",
  "新建企业。名字创建后不可改、不可删。",
  {
    body: [f("name", "string", "企业名，不能为空。", { required: true })],
    response: [f("name", "string", "企业名。")],
    exampleBody: { name: "acme" },
    exampleResponse: { name: "acme" },
  },
);

const disableEnterprise = rest(
  "disable-enterprise",
  "停用企业",
  "POST",
  "/admin/api/enterprises/{name}/disable",
  "停用后该企业下 VK 立刻 403，不打上游。",
  {
    headers: [],
    response: [f("status", "string", "固定 `ok`。")],
    exampleResponse: { status: "ok" },
  },
);

const listProjects = rest(
  "list-projects",
  "项目列表",
  "GET",
  "/admin/api/projects",
  "列出全部 Team。路径仍用 P1 的 `/admin/api/projects`。",
  {
    response: [f("projects", "object[]", "Team 数组。字段名 `projects` 为过渡。", { children: projectFields })],
    exampleResponse: { projects: [{ name: "demo" }] },
  },
);

const createProject = rest(
  "create-project",
  "创建项目",
  "POST",
  "/admin/api/projects",
  "新建 Team。路径仍用 P1 的 `/admin/api/projects`。",
  {
    body: [f("name", "string", "Team 名，不能为空。", { required: true })],
    response: [f("name", "string", "Team 名。")],
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
  "为已有 Team 发一把 VK。明文只在这次响应里出现。",
  {
    body: [f("project", "string", "已存在的 Team 名。字段名 `project` 为过渡。", { required: true })],
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

const createProviderKey = rest(
  "create-provider-key",
  "录入 Provider Key",
  "POST",
  "/admin/api/providers/{name}/keys",
  "给已有 Provider 再加一把 Key。明文只在请求里出现一次。",
  {
    body: [f("api_key", "string", "官方 Key 明文。", { required: true })],
    response: [
      f("id", "string", "Key id。"),
      f("provider", "string", "所属 Provider。"),
      f("disabled", "boolean", "停用后从所有 Channel 池拿掉。"),
    ],
    exampleBody: { api_key: "sk-upstream-secret" },
    exampleResponse: { id: "pk-demo", provider: "deepseek", disabled: false },
  },
);

const listProviderKeys = rest(
  "list-provider-keys",
  "Provider Key 列表",
  "GET",
  "/admin/api/providers/{name}/keys",
  "列出该 Provider 下的 Key 元数据，不含明文。",
  {
    response: [
      f("keys", "object[]", "不含 ciphertext。", {
        children: [
          f("id", "string", "Key id。"),
          f("provider", "string", "所属 Provider。"),
          f("disabled", "boolean", "是否停用。"),
        ],
      }),
    ],
    exampleResponse: { keys: [{ id: "pk-demo", provider: "deepseek", disabled: false }] },
  },
);

const disableProviderKey = rest(
  "disable-provider-key",
  "停用 Provider Key",
  "POST",
  "/admin/api/providers/{name}/keys/{id}/disable",
  "停用后挂着它的 Channel 不再入选。",
  {
    headers: [],
    response: [f("status", "string", "固定 `disabled`。")],
    exampleResponse: { status: "disabled" },
  },
);

const createChannel = rest(
  "create-channel",
  "创建 Channel",
  "POST",
  "/admin/api/channels",
  "同一 (model, Provider Key) 只能一条。没有成本价的 Channel 不会入选。",
  {
    body: [
      f("model", "string", "已登记的 model。", { required: true }),
      f("provider_key", "string", "Provider Key id。", { required: true }),
      f("weight", "integer", "同优先级内的权重。0 为备路。"),
      f("priority", "integer", "数字越大越先。"),
      f("input_cny", "number", "每百万 input Token 成本价。"),
      f("output_cny", "number", "每百万 output Token 成本价。"),
      f("cached_cny", "number", "每百万 cached Token 成本价。"),
    ],
    response: [
      f("id", "string", "Channel id。"),
      f("model", "string", "model。"),
      f("provider_key", "string", "Key id。"),
    ],
    exampleBody: {
      model: "gpt-4o-mini",
      provider_key: "pk-demo",
      weight: 1,
      priority: 10,
      input_cny: 1,
      output_cny: 2,
      cached_cny: 0.1,
    },
    exampleResponse: {
      id: "ch-demo",
      model: "gpt-4o-mini",
      provider_key: "pk-demo",
      weight: 1,
      priority: 10,
      disabled: false,
      input_cny: 1,
      output_cny: 2,
      cached_cny: 0.1,
    },
  },
);

const listChannels = rest(
  "list-channels",
  "Channel 列表",
  "GET",
  "/admin/api/channels",
  "按 model 过滤可选。调用方看不见 Channel。",
  {
    query: [f("model", "string", "只看这个 model 的池。")],
    response: [f("channels", "object[]", "Channel。")],
    exampleResponse: {
      channels: [
        {
          id: "ch-demo",
          model: "gpt-4o-mini",
          provider_key: "pk-demo",
          weight: 1,
          priority: 10,
          disabled: false,
        },
      ],
    },
  },
);

const disableChannel = rest(
  "disable-channel",
  "停用 Channel",
  "POST",
  "/admin/api/channels/{id}/disable",
  "管理员手停后这条 Channel 不再入选。",
  {
    headers: [],
    response: [f("status", "string", "固定 `disabled`。")],
    exampleResponse: { status: "disabled" },
  },
);

const createProvider = rest(
  "create-provider",
  "录入 Provider",
  "POST",
  "/admin/api/providers",
  "登记家族 + base URL；请求里的 api_key 会同时建成第一把 Provider Key。",
  {
    description: "Provider 本身不含密钥。`api_key` 加密后写成一把 Provider Key，响应永不回 secret。",
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
  "按 Team × Model × 日聚合。日界为 Asia/Shanghai。查询参数仍叫 `project`。",
  {
    query: [
      f("day", "string", "YYYY-MM-DD。缺省为上海时区今天。"),
      f("project", "string", "按 Team 过滤。空则全部。字段名 `project` 为过渡。"),
    ],
    response: [
      f("day", "string", "查询的日。"),
      f("project", "string", "查询的 Team 过滤，空为全部。"),
      f("rows", "object[]", "聚合行。", {
        children: [
          f("project", "string", "Team。字段名 `project` 为过渡。"),
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
  "列出某 Team 的请求流水（账本粒度）。查询参数仍叫 `project`。",
  {
    query: [f("project", "string", "Team 名。缺省为种子 Team `demo`。")],
    response: [
      f("project", "string", "查询的 Team。"),
      f("requests", "object[]", "流水。", {
        children: [
          f("virtual_key_hash", "string", "VK 哈希。"),
          f("project", "string", "Team。字段名 `project` 为过渡。"),
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
          f("attempts", "object[]", "同一次入口内各次 Channel 尝试快照。usage 以最后一次为准，cost 为各次之和。"),
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
      { kind: "api", doc: createUser },
      { kind: "api", doc: addMember },
      { kind: "api", doc: removeMember },
    ],
  },
  {
    title: "企业",
    items: [
      { kind: "api", doc: listEnterprises },
      { kind: "api", doc: createEnterprise },
      { kind: "api", doc: disableEnterprise },
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
      { kind: "api", doc: listProviderKeys },
      { kind: "api", doc: createProviderKey },
      { kind: "api", doc: disableProviderKey },
    ],
  },
  {
    title: "Model 映射",
    items: [
      { kind: "api", doc: listModels },
      { kind: "api", doc: createModel },
      { kind: "api", doc: disableModel },
      { kind: "api", doc: listChannels },
      { kind: "api", doc: createChannel },
      { kind: "api", doc: disableChannel },
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
    .replace("/enterprises/{name}", "/enterprises/acme")
    .replace("/teams/{name}/members/{username}", "/teams/billing/members/acme-dev")
    .replace("/teams/{name}", "/teams/billing")
    .replace("/keys/{id}", "/keys/pk-demo")
    .replace("/channels/{id}", "/channels/ch-demo")
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
