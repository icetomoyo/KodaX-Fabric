# KodaX Fabric

企业级 Token 统一接入与 Token ROI 平台。企业所有 LLM API 调用经过 Fabric 网关。

## Language

**KodaX Fabric**:
产品本身：Token Hub + Token ROI。统一接入、计量，并回答 Token 花在哪、值不值。
_Avoid_: Agent 控制平面, Agent Runtime, 产能调度平台

**零转换透传**:
OpenAI 系端点只路由 OpenAI 系 Provider，Anthropic 系端点只路由 Anthropic 系 Provider。不改写请求/响应体。
_Avoid_: 跨协议转换, 统一适配器

**OpenAI 系**:
讲 OpenAI Chat Completions 协议的上游，包括兼容该协议的 base URL。
_Avoid_: 只等于官方 OpenAI, Azure OpenAI（鉴权/路径不兼容时另算）

**Anthropic 系**:
讲 Anthropic Messages 协议的上游。

### Access

**Project**:
独立的成本桶。Virtual Key 属于一个 Project。当前没有父级（没有 Organization / Team）。一次调用记到哪个 Project，只看这把 VK 的绑定；header 不能改记到别处。名字创建后不可改，也不可删除。
_Avoid_: Tenant, 账号, account

**Virtual Key**:
调用方拿着的凭证，绑定一个 Project。明文只在创建时出现一次。一生只有创建和停用；停用后新请求立刻拒绝。换秘密 = 新建一把再停用旧的，没有轮换。
_Avoid_: API key（会和 Provider Key 混）, token

**Provider**:
上游 LLM 厂商，按协议家族分成 OpenAI 系或 Anthropic 系。
_Avoid_: 渠道（渠道是后来的东西：Provider + Key + 模型 + 权重 + 优先级）

**Provider Key**:
Fabric 用来调 Provider 的凭据，加密存放，永不下发给调用方，也不出现在日志和 API 响应里。
_Avoid_: API key（单独说）

**Model**:
线路上的 `model` 字符串。它唯一选定一对 Provider + Provider Key。未登记、或没有价格行的 Model 不能调用。
_Avoid_: 别名, 渠道

### Ledger

**Request**:
一次经过网关的 HTTP 调用，不论成败。账本里不可改的一粒：有 usage 则记 token 和成本，没有则 token 与成本为 0，状态照记。禁止 UPDATE。可选带不透明的 `task_type`，当前不解释。
_Avoid_: 日志行, 事件

**Usage**:
Provider 响应里的 token 计数（input / output / cached）。Fabric 的 token 数只来自这里。
_Avoid_: 本地 tokenizer, 字符估算

**Run**:
Request 上的可选分组键，不是账本的一粒。只认调用方显式传入的 `run_id`；没有就是空，不做时间窗口推断。
_Avoid_: session, conversation, trace, 推断 Run

**Adjustment**:
纠正账本的唯一方式：再追加一行差额。不改历史 Request。当前阶段还不做。
_Avoid_: 改流水, 编辑 Request

**价格表**:
每个 Model 一行成本价（输入 / 输出 / 缓存），货币为 CNY。这是付给 Provider 的价，不是对客价。
_Avoid_: 标准价, 对客价, tariff

**日**:
报表里的一天，按 Asia/Shanghai 切。Request 的时刻按此时区归日。
_Avoid_: UTC 日, 每个 Project 自己的时区
