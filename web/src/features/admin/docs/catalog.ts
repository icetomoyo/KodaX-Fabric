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
    description: "登录接口下发的 `th_session`。缺失或过期返回 401 `unauthorized`。",
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

const operatorFields: DocField[] = [
  { name: "id", type: "integer", description: "用户 ID。" },
  { name: "phone", type: "string", description: "手机号。" },
  { name: "name", type: "string", description: "显示名。" },
  { name: "role", type: "enum<string>", description: "`admin` 或 `developer`。" },
  { name: "status", type: "enum<string>", description: "`active` 或 `disabled`。" },
  { name: "created_at", type: "string", description: "创建时间。" },
];

const operatorExample = {
  id: 1,
  phone: "18612243416",
  name: "管理员",
  role: "admin",
  status: "active",
  created_at: "2026-08-13T00:00:00Z",
};

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
  const cookie = opts.cookie !== false && id !== "health";
  return {
    id,
    title,
    method,
    path,
    summary,
    description:
      opts.description ??
      (opts.adminOnly ? "需要管理员 Session。" : cookie ? "需要已登录 Session。" : "无需鉴权。"),
    adminOnly: opts.adminOnly,
    auth: cookie ? cookieAuth : [],
    headers: opts.headers ?? (method === "GET" ? [] : jsonHeader),
    query: opts.query,
    body: opts.body ?? [],
    response: opts.response,
    exampleBody: opts.exampleBody,
    exampleResponse: opts.exampleResponse,
    cookie,
  };
}

const health = rest(
  "health",
  "健康检查",
  "GET",
  "/health",
  "网关存活探测。生产入口会带上 Postgres / Redis。",
  {
    cookie: false,
    description: "网关进程健康检查。compose 部署时由外层 mux 覆盖，额外探测数据库和可选 Redis。",
    response: [
      f("ok", "boolean", "依赖都通才为 true。"),
      f("service", "string", "固定 `kodax-fabric-gateway`。"),
      f("postgres", "boolean", "生产入口：库是否可连。"),
      f("redis", "boolean", "未配 Redis 时为 true。"),
    ],
    exampleResponse: { ok: true, service: "kodax-fabric-gateway", postgres: true, redis: true },
  },
);

const login = rest("login", "登录", "POST", "/console/v1/login", "手机号 + 密码换 Session。", {
  cookie: false,
  description: "校验通过后写 HttpOnly Cookie `th_session`，有效期 24 小时。",
  body: [
    f("phone", "string", "手机号。", { required: true }),
    f("password", "string", "密码。", { required: true }),
  ],
  response: [f("operator", "object", "当前用户。", { children: operatorFields })],
  exampleBody: { phone: "18612243416", password: "Hz@123456" },
  exampleResponse: { operator: operatorExample },
});

const logout = rest("logout", "退出", "POST", "/console/v1/logout", "吊销当前 Session。", {
  cookie: false,
  description: "清除 `th_session`。没有 Cookie 也返回成功。",
  headers: [],
  response: [f("ok", "boolean", "固定 true。")],
  exampleResponse: { ok: true },
});

const me = rest("me", "当前用户", "GET", "/console/v1/me", "读取登录身份。", {
  response: [f("operator", "object", "当前用户。", { children: operatorFields })],
  exampleResponse: { operator: operatorExample },
});

const patchMe = rest(
  "patch-me",
  "更新资料",
  "PATCH",
  "/console/v1/me",
  "改自己的显示名、手机号或密码。",
  {
    body: [
      f("name", "string", "显示名。"),
      f("phone", "string", "登录手机号，唯一。"),
      f("password", "string", "新密码，至少 8 位。"),
    ],
    response: [f("operator", "object", "更新后的用户。", { children: operatorFields })],
    exampleBody: { name: "张三", phone: "13800138000", password: "" },
    exampleResponse: { operator: { ...operatorExample, name: "张三" } },
  },
);

const myKeys = rest(
  "me-keys",
  "我的虚拟钥匙",
  "GET",
  "/console/v1/me/keys",
  "列出发给当前用户的 VK。",
  {
    description: "只返回掩码与前缀，没有明文。开发者工作台用这个接口。",
    response: [f("virtual_keys", "object[]", "该用户的虚拟钥匙。")],
    exampleResponse: {
      virtual_keys: [
        {
          id: 1,
          pool_id: 1,
          owner_id: 2,
          project_id: 1,
          status: "active",
          key_prefix: "fab-",
          key_masked: "fab-••••01",
        },
      ],
    },
  },
);

const overview = rest("overview", "总览", "GET", "/console/v1/overview", "控制台计数卡片。", {
  adminOnly: true,
  response: [
    f("operators", "integer", "用户数。"),
    f("provider_keys", "integer", "上游钥匙总数。"),
    f("active_keys", "integer", "启用中的上游钥匙。"),
    f("disabled_keys", "integer", "已停用。"),
    f("pools", "integer", "渠道池数。"),
    f("channels", "integer", "渠道数。"),
    f("virtual_keys", "integer", "虚拟钥匙数。"),
    f("teams", "integer", "团队数。"),
    f("projects", "integer", "项目数。"),
  ],
  exampleResponse: {
    operators: 2,
    provider_keys: 1,
    active_keys: 1,
    disabled_keys: 0,
    pools: 1,
    channels: 2,
    virtual_keys: 1,
    teams: 1,
    projects: 1,
  },
});

const listTeams = rest("list-teams", "团队列表", "GET", "/console/v1/teams", "列出全部团队。", {
  response: [f("teams", "object[]", "`id` + `name`。")],
  exampleResponse: { teams: [{ id: 1, name: "研发" }] },
});

const createTeam = rest("create-team", "创建团队", "POST", "/console/v1/teams", "新建团队。", {
  adminOnly: true,
  body: [f("name", "string", "团队名。", { required: true })],
  response: [f("id", "integer", "新团队 ID。"), f("name", "string", "名称。")],
  exampleBody: { name: "研发" },
  exampleResponse: { id: 1, name: "研发" },
});

const listProjects = rest(
  "list-projects",
  "项目列表",
  "GET",
  "/console/v1/projects",
  "列出全部项目。",
  {
    response: [f("projects", "object[]", "`id` / `team_id` / `name`。")],
    exampleResponse: { projects: [{ id: 1, team_id: 1, name: "默认项目" }] },
  },
);

const createProject = rest(
  "create-project",
  "创建项目",
  "POST",
  "/console/v1/projects",
  "在团队下建项目。",
  {
    adminOnly: true,
    body: [
      f("team_id", "integer", "所属团队。", { required: true }),
      f("name", "string", "项目名。", { required: true }),
    ],
    response: [
      f("id", "integer", "新项目 ID。"),
      f("team_id", "integer", "团队。"),
      f("name", "string", "名称。"),
    ],
    exampleBody: { team_id: 1, name: "默认项目" },
    exampleResponse: { id: 1, team_id: 1, name: "默认项目" },
  },
);

const listUsers = rest("list-users", "用户列表", "GET", "/console/v1/users", "列出全部操作员。", {
  adminOnly: true,
  response: [f("users", "object[]", "用户数组。", { children: operatorFields })],
  exampleResponse: { users: [operatorExample] },
});

const createUser = rest(
  "create-user",
  "创建用户",
  "POST",
  "/console/v1/users",
  "创建管理员或开发者。",
  {
    adminOnly: true,
    body: [
      f("phone", "string", "手机号，唯一。", { required: true }),
      f("name", "string", "显示名。", { required: true }),
      f("role", "enum<string>", "`admin` 或 `developer`。", { required: true }),
      f("password", "string", "初始密码。", { required: true }),
    ],
    response: [f("user", "object", "新建用户。", { children: operatorFields })],
    exampleBody: {
      phone: "13800138000",
      name: "开发者",
      role: "developer",
      password: "Dev@123456",
    },
    exampleResponse: {
      user: { ...operatorExample, id: 2, phone: "13800138000", name: "开发者", role: "developer" },
    },
  },
);

const patchUser = rest(
  "patch-user",
  "更新用户",
  "PATCH",
  "/console/v1/users/{id}",
  "改角色、状态、姓名或密码。",
  {
    adminOnly: true,
    description: "不能停用最后一个管理员。路径 `{id}` 为用户 ID。",
    body: [
      f("name", "string", "显示名。"),
      f("role", "enum<string>", "`admin` / `developer`。"),
      f("status", "enum<string>", "`active` / `disabled`。"),
      f("password", "string", "重置密码。"),
    ],
    response: [f("user", "object", "更新后的用户。", { children: operatorFields })],
    exampleBody: { status: "disabled" },
    exampleResponse: { user: { ...operatorExample, status: "disabled" } },
  },
);

const listPKs = rest(
  "list-provider-keys",
  "上游钥匙列表",
  "GET",
  "/console/v1/provider-keys",
  "列出官方 Key 元数据，不含明文。",
  {
    adminOnly: true,
    response: [f("provider_keys", "object[]", "上游钥匙。")],
    exampleResponse: {
      provider_keys: [
        { id: 1, provider_code: "deepseek", status: "active", team_id: 1, rpm_limit: 0 },
      ],
    },
  },
);

const createPK = rest(
  "create-provider-key",
  "录入上游钥匙",
  "POST",
  "/console/v1/provider-keys",
  "加密入库一把官方 Key。",
  {
    adminOnly: true,
    description: "明文只在请求里出现一次，库内加密。响应不回 secret。",
    body: [
      f("provider_code", "string", "供应商编码，如 `deepseek` / `openai`。", { required: true }),
      f("secret", "string", "官方 Key 明文。", { required: true }),
      f("team_id", "integer", "归属团队。"),
      f("rpm_limit", "integer", "该 Provider 共用 RPM，0 或不设为不限。"),
    ],
    response: [
      f("id", "integer", "新钥匙 ID。"),
      f("provider_code", "string", "供应商。"),
      f("status", "string", "默认 `active`。"),
      f("team_id", "integer", "团队。"),
      f("rpm_limit", "integer", "RPM。"),
    ],
    exampleBody: { provider_code: "deepseek", secret: "sk-xxxx", team_id: 1 },
    exampleResponse: {
      id: 1,
      provider_code: "deepseek",
      status: "active",
      team_id: 1,
      rpm_limit: 0,
    },
  },
);

const patchPK = rest(
  "patch-provider-key",
  "更新上游钥匙",
  "PATCH",
  "/console/v1/provider-keys/{id}",
  "停用、换团队或改 RPM。",
  {
    adminOnly: true,
    body: [
      f("status", "enum<string>", "`active` / `disabled`。"),
      f("team_id", "integer", "归属团队。"),
      f("rpm_limit", "integer", "Provider RPM。"),
    ],
    response: [
      f("id", "integer", "ID。"),
      f("provider_code", "string", "供应商。"),
      f("status", "string", "状态。"),
      f("team_id", "integer", "团队。"),
      f("rpm_limit", "integer", "RPM。"),
    ],
    exampleBody: { status: "disabled", rpm_limit: 60 },
    exampleResponse: {
      id: 1,
      provider_code: "deepseek",
      status: "disabled",
      team_id: 1,
      rpm_limit: 60,
    },
  },
);

const listPools = rest("list-pools", "渠道池列表", "GET", "/console/v1/pools", "列出渠道池。", {
  response: [f("pools", "object[]", "`id` / `name` / `group_name` / `team_id`。")],
  exampleResponse: { pools: [{ id: 1, name: "默认池", group_name: "standard", team_id: 1 }] },
});

const createPool = rest(
  "create-pool",
  "创建渠道池",
  "POST",
  "/console/v1/pools",
  "新建池并指定分组。",
  {
    adminOnly: true,
    body: [
      f("name", "string", "池名。", { required: true }),
      f("group_name", "enum<string>", "`premium` / `standard` / `bulk`。", { required: true }),
      f("team_id", "integer", "归属团队。"),
    ],
    response: [
      f("id", "integer", "新池 ID。"),
      f("name", "string", "名称。"),
      f("group_name", "string", "分组。"),
      f("team_id", "integer", "团队。"),
    ],
    exampleBody: { name: "默认池", group_name: "standard", team_id: 1 },
    exampleResponse: { id: 1, name: "默认池", group_name: "standard", team_id: 1 },
  },
);

const patchPool = rest(
  "patch-pool",
  "更新渠道池",
  "PATCH",
  "/console/v1/pools/{id}",
  "改名、分组或团队。",
  {
    adminOnly: true,
    body: [
      f("name", "string", "池名。"),
      f("group_name", "enum<string>", "`premium` / `standard` / `bulk`。"),
      f("team_id", "integer", "团队。"),
    ],
    response: [
      f("id", "integer", "ID。"),
      f("name", "string", "名称。"),
      f("group_name", "string", "分组。"),
      f("team_id", "integer", "团队。"),
    ],
    exampleBody: { group_name: "premium" },
    exampleResponse: { id: 1, name: "默认池", group_name: "premium", team_id: 1 },
  },
);

const listChannels = rest(
  "list-channels",
  "渠道列表",
  "GET",
  "/console/v1/channels",
  "列出池内渠。",
  {
    adminOnly: true,
    response: [f("channels", "object[]", "渠：池、官方 Key、协议、上游地址、状态。")],
    exampleResponse: {
      channels: [
        {
          id: 1,
          pool_id: 1,
          provider_key_id: 1,
          protocol: "openai_chat",
          base_url: "https://api.deepseek.com",
          status: "active",
        },
      ],
    },
  },
);

const createChannel = rest(
  "create-channel",
  "创建渠道",
  "POST",
  "/console/v1/channels",
  "把官方 Key 挂进池。",
  {
    adminOnly: true,
    body: [
      f("pool_id", "integer", "所属池。", { required: true }),
      f("provider_key_id", "integer", "上游钥匙。", { required: true }),
      f("protocol", "enum<string>", "`openai_chat` 或 `anthropic_messages`。", { required: true }),
      f("base_url", "string", "上游根地址。", { required: true }),
    ],
    response: [
      f("id", "integer", "新渠 ID。"),
      f("pool_id", "integer", "池。"),
      f("provider_key_id", "integer", "上游钥匙。"),
      f("protocol", "string", "协议。"),
      f("base_url", "string", "上游。"),
      f("status", "string", "默认 `active`。"),
    ],
    exampleBody: {
      pool_id: 1,
      provider_key_id: 1,
      protocol: "openai_chat",
      base_url: "https://api.deepseek.com",
    },
    exampleResponse: {
      id: 1,
      pool_id: 1,
      provider_key_id: 1,
      protocol: "openai_chat",
      base_url: "https://api.deepseek.com",
      status: "active",
    },
  },
);

const patchChannel = rest(
  "patch-channel",
  "更新渠道",
  "PATCH",
  "/console/v1/channels/{id}",
  "停用或改上游地址。",
  {
    adminOnly: true,
    body: [
      f("status", "enum<string>", "`active` / `disabled`。"),
      f("base_url", "string", "上游根地址。"),
    ],
    response: [
      f("id", "integer", "ID。"),
      f("pool_id", "integer", "池。"),
      f("provider_key_id", "integer", "上游钥匙。"),
      f("protocol", "string", "协议。"),
      f("base_url", "string", "上游。"),
      f("status", "string", "状态。"),
    ],
    exampleBody: { status: "disabled" },
    exampleResponse: {
      id: 1,
      pool_id: 1,
      provider_key_id: 1,
      protocol: "openai_chat",
      base_url: "https://api.deepseek.com",
      status: "disabled",
    },
  },
);

const listVKs = rest(
  "list-virtual-keys",
  "虚拟钥匙列表",
  "GET",
  "/console/v1/virtual-keys",
  "管理员查看全部 VK。",
  {
    adminOnly: true,
    response: [f("virtual_keys", "object[]", "不含明文。")],
    exampleResponse: {
      virtual_keys: [
        {
          id: 1,
          pool_id: 1,
          owner_id: 2,
          project_id: 1,
          status: "active",
          key_prefix: "fab-",
          key_masked: "fab-••••01",
        },
      ],
    },
  },
);

const createVK = rest(
  "create-virtual-key",
  "发放虚拟钥匙",
  "POST",
  "/console/v1/virtual-keys",
  "管理员直接发放。明文只在这次响应里出现。",
  {
    adminOnly: true,
    body: [
      f("pool_id", "integer", "绑定的池。", { required: true }),
      f("owner_id", "integer", "持有人。", { required: true }),
      f("project_id", "integer", "可选项目。"),
    ],
    response: [
      f("id", "integer", "VK ID。"),
      f("secret", "string", "明文，只此一次。"),
      f("key_masked", "string", "之后只显示这个。"),
      f("status", "string", "`active`。"),
    ],
    exampleBody: { pool_id: 1, owner_id: 2, project_id: 1 },
    exampleResponse: {
      id: 1,
      pool_id: 1,
      owner_id: 2,
      project_id: 1,
      status: "active",
      key_prefix: "fab-",
      key_masked: "fab-••••01",
      secret: SAMPLE_KEY,
    },
  },
);

const patchVK = rest(
  "patch-virtual-key",
  "更新虚拟钥匙",
  "PATCH",
  "/console/v1/virtual-keys/{id}",
  "停用或改绑池 / 主人 / 项目。",
  {
    adminOnly: true,
    body: [
      f("status", "enum<string>", "`active` / `disabled`。"),
      f("owner_id", "integer", "持有人。"),
      f("pool_id", "integer", "池。"),
      f("project_id", "integer", "项目。"),
    ],
    response: [
      f("id", "integer", "ID。"),
      f("status", "string", "状态。"),
      f("key_masked", "string", "掩码。"),
    ],
    exampleBody: { status: "disabled" },
    exampleResponse: {
      id: 1,
      pool_id: 1,
      owner_id: 2,
      project_id: 1,
      status: "disabled",
      key_prefix: "fab-",
      key_masked: "fab-••••01",
    },
  },
);

const applyVK = rest(
  "apply-vk",
  "申请虚拟钥匙",
  "POST",
  "/console/v1/vk-requests",
  "开发者申请一把 VK，状态为 pending。",
  {
    description: "主人固定为当前登录用户。批准前不能打 `/v1`。响应没有明文。",
    body: [
      f("pool_id", "integer", "想绑定的池。", { required: true }),
      f("project_id", "integer", "可选项目。"),
    ],
    response: [f("id", "integer", "申请 ID。"), f("status", "string", "`pending`。")],
    exampleBody: { pool_id: 1 },
    exampleResponse: {
      id: 2,
      pool_id: 1,
      owner_id: 2,
      project_id: 0,
      status: "pending",
      key_prefix: "fab-",
      key_masked: "fab-••••",
    },
  },
);

const approveVK = rest(
  "approve-vk",
  "批准申请",
  "POST",
  "/console/v1/vk-requests/{id}/approve",
  "管理员批准后亮一次明文。",
  {
    adminOnly: true,
    headers: [],
    response: [f("secret", "string", "明文，只此一次。"), f("status", "string", "`active`。")],
    exampleResponse: {
      id: 2,
      pool_id: 1,
      owner_id: 2,
      project_id: 0,
      status: "active",
      key_prefix: "fab-",
      key_masked: "fab-••••ab",
      secret: SAMPLE_KEY,
    },
  },
);

const listAliases = rest(
  "list-aliases",
  "模型别名",
  "GET",
  "/console/v1/model-aliases",
  "列出同协议 fallback。",
  {
    adminOnly: true,
    response: [f("model_aliases", "object[]", "`protocol` / `model` / `fallback`。")],
    exampleResponse: {
      model_aliases: [{ protocol: "openai_chat", model: "gpt-4", fallback: "gpt-4o" }],
    },
  },
);

const putAlias = rest(
  "put-alias",
  "配置模型别名",
  "PUT",
  "/console/v1/model-aliases",
  "主模型全挂后只改写出站 model。",
  {
    adminOnly: true,
    description: "不跨协议。网关启动时从库加载；本进程内新写入要重启才进热路径（以现网实现为准）。",
    body: [
      f("protocol", "string", "`openai_chat` 或 `anthropic_messages`。", { required: true }),
      f("model", "string", "请求里的主模型。", { required: true }),
      f("fallback", "string", "备选模型。", { required: true }),
    ],
    response: [
      f("protocol", "string", "协议。"),
      f("model", "string", "主模型。"),
      f("fallback", "string", "备选。"),
    ],
    exampleBody: { protocol: "openai_chat", model: "gpt-4", fallback: "gpt-4o" },
    exampleResponse: { protocol: "openai_chat", model: "gpt-4", fallback: "gpt-4o" },
  },
);

const routeDecisions = rest(
  "route-decisions",
  "路由审计",
  "GET",
  "/console/v1/route-decisions",
  "最近选路记录。",
  {
    adminOnly: true,
    query: [f("limit", "integer", "条数，默认 50。")],
    response: [f("route_decisions", "object[]", "对应响应头 `X-Fabric-*`。")],
    exampleResponse: {
      route_decisions: [
        {
          request_id: "a1b2c3d4e5f6a7b8",
          channel_id: 1,
          reason: "priority",
          fallback: false,
          pool_group: "standard",
          created_at: "2026-08-14T00:00:00Z",
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
      { kind: "api", doc: patchMe },
      { kind: "api", doc: myKeys },
    ],
  },
  {
    title: "组织",
    items: [
      { kind: "api", doc: overview },
      { kind: "api", doc: listTeams },
      { kind: "api", doc: createTeam },
      { kind: "api", doc: listProjects },
      { kind: "api", doc: createProject },
      { kind: "api", doc: listUsers },
      { kind: "api", doc: createUser },
      { kind: "api", doc: patchUser },
    ],
  },
  {
    title: "上游钥匙",
    items: [
      { kind: "api", doc: listPKs },
      { kind: "api", doc: createPK },
      { kind: "api", doc: patchPK },
    ],
  },
  {
    title: "渠道池",
    items: [
      { kind: "api", doc: listPools },
      { kind: "api", doc: createPool },
      { kind: "api", doc: patchPool },
    ],
  },
  {
    title: "渠道",
    items: [
      { kind: "api", doc: listChannels },
      { kind: "api", doc: createChannel },
      { kind: "api", doc: patchChannel },
    ],
  },
  {
    title: "虚拟钥匙",
    items: [
      { kind: "api", doc: listVKs },
      { kind: "api", doc: createVK },
      { kind: "api", doc: patchVK },
      { kind: "api", doc: applyVK },
      { kind: "api", doc: approveVK },
    ],
  },
  {
    title: "路由",
    items: [
      { kind: "api", doc: routeDecisions },
      { kind: "api", doc: listAliases },
      { kind: "api", doc: putAlias },
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
  const path = ep.path.replace("{id}", "1");
  const url = `${base}${path}`;
  const body = ep.exampleBody ? JSON.stringify(ep.exampleBody, null, 2) : "";
  const response = JSON.stringify(ep.exampleResponse ?? {}, null, 2);
  const cookie = ep.cookie ? " --cookie 'th_session=…'" : "";
  const contentType =
    ep.method !== "GET" && body ? " --header 'Content-Type: application/json'" : "";
  const data = body ? ` --data '\n${body}\n'` : "";
  const curl = `curl --request ${ep.method} \\\n  --url ${url}${cookie}${contentType}${data}`;

  const headers: Record<string, string> = {};
  if (ep.cookie) headers.Cookie = "th_session=…";
  if (ep.method !== "GET" && body) headers["Content-Type"] = "application/json";
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
    ${ep.cookie ? 'cookies={"th_session": "…"},\n    ' : ""}${body ? `json=${body},\n    ` : ""}
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
