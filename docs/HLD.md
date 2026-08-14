# KodaX Fabric — 高层设计（HLD）

> 基于 PRD.md 和 UI_DESIGN.md，定义 Fabric 的技术架构、服务拆分、数据模型和关键流程设计。
> 本文档面向研发团队，作为详细设计（LLD）和实现的输入。
>
> **现行 Token Hub（v0.1.3）**：`operators.role` 仅 `org_admin` / `team_admin` / `developer`。表是 `operators`（手机号登录），不是下文 `users` + email。§6.1 含 `super_admin` 的四角色与 RLS 是目标架构。

---

## 目录

```
1. 系统架构
  1.1 架构总览
  1.2 服务拆分
  1.3 技术选型

2. 数据模型
  2.1 实体关系图
  2.2 核心实体定义
  2.3 存储策略

3. 网关层设计
  3.1 请求处理流程
  3.2 双端点零转换
  3.3 路由引擎
  3.4 渠道池化
  3.5 限流
  3.6 熔断与健康检查
  3.7 缓存
  3.8 流式透传

4. 计量层设计
  4.1 Token 分类器
  4.2 文件级成本归因
  4.3 四套账本
  4.4 预算引擎
  4.5 浪费检测
  4.6 ROI 计算

5. 定价与计费设计
  5.1 Pricebook
  5.2 AI Credit
  5.3 套餐与三层计量
  5.4 账单生成

6. 治理层设计
  6.1 RBAC 与多租户
  6.2 Virtual Key 生命周期
  6.3 数据保存与生命周期

7. API 契约
  7.1 网关 API
  7.2 管理 API
  7.3 错误模型

8. 关键流程时序
  8.1 请求处理全链路
  8.2 预算控制流程
  8.3 渠道故障转移
  8.4 VK 申请审批

9. 部署架构
  9.1 单一企业部署
  9.2 SaaS 部署
  9.3 高可用

10. 非功能性设计
  10.1 性能目标
  10.2 可靠性
  10.3 安全
```

---

## 1. 系统架构

### 1.1 架构总览

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                          客户端应用                                       │
│  OpenAI SDK / Anthropic SDK / Fabric SDK                                 │
│  (只需改 base_url 指向 Fabric)                                            │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │ HTTPS
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          Fabric Gateway (Go)                             │
│                                                                          │
│  请求路径（同步，热路径）:                                                 │
│  ┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐      │
│  │ Auth │ → │ Rate │ → │Budget│ → │Route │ → │Proxy │ → │Meter │      │
│  │ & VK │   │Limit │   │Check │   │Engine│   │(SSE) │   │Async │      │
│  └──────┘   └──────┘   └──────┘   └──────┘   └──┬───┘   └──────┘      │
│                                                 │                        │
│  管理路径（异步，冷路径）:                              │                        │
│  ┌─────────────────────────────────────────────┐ │                        │
│  │  Metering Pipeline                          │ │                        │
│  │  Token Classifier → File Attributor         │ │                        │
│  │  → Cost Calculator → Usage Recorder         │ │                        │
│  │  → Waste Detector → ROI Aggregator          │ │                        │
│  └─────────────────────────────────────────────┘ │                        │
│                                                  │                        │
│  共享状态 (Redis):                                 │                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│  │ Rate     │ │ Budget   │ │ Channel  │ │ Circuit  │ │ Route    │     │
│  │ Counters │ │ Balance  │ │ Health   │ │ Breaker  │ │ Cache    │     │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘     │
└──────────────────────────────────────────────────┼────────────────────────┘
                                                   │ HTTPS
                                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                   LLM Provider (OpenAI / Anthropic / vLLM)               │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                    Admin / Console Backend                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ Provider │ │ Routing  │ │ Budget   │ │ Analytics│ │ Billing  │      │
│  │ Mgmt     │ │ Config   │ │ Mgmt     │ │ Engine   │ │ Engine   │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                                  │
│  │ VK Mgmt  │ │ Audit Log│ │ Data Ret │ │  Console Frontend (React)     │
│  └──────────┘ └──────────┘ └──────────┘                                  │
└──────────────────────────────────────────────────────────────────────────┘

存储层:
  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐
  │ PostgreSQL │  │   Redis    │  │ ClickHouse │  │     S3     │
  │ (config &  │  │ (hot state:│  │ (analytics:│  │ (request/  │
  │  metadata) │  │  rate,     │  │  usage,    │  │  response  │
  │            │  │  budget,   │  │  ROI, cost)│  │  logs)     │
  └────────────┘  │  health)   │  └────────────┘  └────────────┘
                  └────────────┘
```

**设计原则：**

1. **网关无状态** — Gateway 不持有会话状态，所有共享状态在 Redis，水平扩展零障碍
2. **热/冷路径分离** — 请求代理（热路径）与计量分析（冷路径）异步解耦，计量不阻塞响应
3. **零转换** — 网关只做透传，不修改请求/响应体（仅解析用于计量），保证协议语义完整
4. **配置驱动** — 路由/限流/预算/定价等全部配置化，管理后台修改 → PostgreSQL → Redis 缓存 → 网关生效

### 1.2 服务拆分

| 服务 | 职责 | 语言 | 部署特性 | 数据依赖 |
|---|---|---|---|---|
| **Gateway** | 请求代理、路由、限流、预算检查、SSE 透传 | Go | 无状态，多副本，核心路径 | Redis (热状态), PostgreSQL (配置缓存) |
| **Metering Worker** | Token 分类、成本归因、用量记录、浪费检测 | Go | 异步消费事件，批量写入 | ClickHouse, PostgreSQL, Redis |
| **Admin API** | 配置管理 CRUD（Provider/渠道/路由/VK/预算/限流/数据策略/Pricebook/套餐） | Go | 有状态，REST API | PostgreSQL |
| **Analytics Engine** | ROI 聚合、模型对比、趋势分析、路由优化推荐 | Go | 定时批处理 | ClickHouse |
| **Billing Engine** | 账单生成、利润计算、对账 | Go | 定时批处理 | PostgreSQL, ClickHouse |
| **Console Frontend** | 管理控制台 SPA | React + TS | 静态部署 (CDN/Nginx) | Admin API |

> **V1 简化**：Gateway + Metering Worker + Admin API 可合并为一个进程的不同模块（Go 内 goroutine 池），降低部署复杂度。V2 按负载拆分为独立服务。

### 1.3 技术选型

| 组件 | 选型 | 理由 |
|---|---|---|
| 网关语言 | **Go** | 高并发（goroutine）、低延迟、SSE 原生支持、内存安全 |
| 管理后端 | **Go** | 与网关同语言，V1 可同进程部署 |
| 前端 | **React + TypeScript** | 组件生态成熟，管理控制台标准选型 |
| 配置存储 | **PostgreSQL** | ACID 事务，关系型配置数据，JSONB 支持灵活字段 |
| 热状态存储 | **Redis Cluster** | 限流计数器、预算余额、渠道健康——毫秒级读写，Lua 脚本保证原子性 |
| 分析存储 | **ClickHouse** | 时序聚合查询（ROI 趋势、用量下钻），列式存储高压缩比 |
| 日志存储 | **S3 兼容** | 请求/响应正文，按项目 + TTL 分区，低成本大容量 |
| 消息队列 | **Redis Streams** | V1 简化（与热状态同实例）；V2 可切换 Kafka |
| 部署 | **Docker + K8s** | 容器化，水平扩展，滚动更新 |
| 加密 | **AES-256-GCM** | Provider Key 加密存储 |
| Tokenizer | **tiktoken (OpenAI) / anthropic-tokenizer** | 流式 Token 估算 |

---

## 2. 数据模型

### 2.1 实体关系图

```text
┌─────────────┐
│   Tenant    │ (SaaS only; 单一企业为单 Tenant)
│  id, name   │
└──────┬──────┘
       │ 1:N
┌──────▼──────┐
│Organization │
│ id, tenant  │
│ name, config│
└──────┬──────┘
       │ 1:N
┌──────▼──────┐       ┌──────────────┐
│    Team     │       │   Provider   │
│ id, org_id  │       │ id, name     │
│ name, budget│       │ protocol     │
└──────┬──────┘       │ base_url     │
       │ 1:N          └──────┬───────┘
┌──────▼──────┐               │ 1:N
│  Project    │       ┌───────▼────────┐
│ id, team_id │       │ ProviderKey    │
│ name, desc  │       │ id, provider_id│
│ data_mode   │       │ encrypted_key  │
└──────┬──────┘       │ status, quota  │
       │ 1:N          └───────┬────────┘
┌──────▼──────┐               │
│ VirtualKey  │               │
│ id (fab-)   │       ┌───────▼────────┐
│ project_id  │       │    Channel     │
│ budget_lim  │◄──────┤ id, provider   │
│ rpm/tpm_lim │       │ key_id         │
│ model_scope │       │ model, weight  │
│ pool_group  │       │ priority       │
│ expires_at  │       │ status         │
│ ip_whitelist│       └───────┬────────┘
└──────┬──────┘               │
       │                      │ N:1
       │               ┌──────▼──────┐
       │               │ ChannelPool │
       │               │ id, name    │
       │               │ group       │
       │               │ rpm/tpm_cap │
       │               └─────────────┘
       │
┌──────▼──────────┐
│     Run         │
│ id, vk_id       │
│ started_at      │
│ ended_at        │
│ status          │
│ total_cost      │
└──────┬──────────┘
       │ 1:N
┌──────▼──────────┐
│  RequestLog     │
│ id, run_id      │
│ provider, model │
│ input_tokens    │
│ output_tokens   │
│ cost            │
│ latency_ms      │
│ status_code     │
│ route_decision  │
└──────┬──────────┘
       │ 1:N
┌──────▼──────────┐
│ TokenBreakdown  │
│ request_log_id  │
│ token_type      │ (system/user/context/tool_result/injected/
│                  │  final_output/tool_call/thinking/structured)
│ direction       │ (input/output)
│ count           │
│ weight          │
│ cache_factor    │
│ cost            │
└─────────────────┘

┌─────────────────┐
│ FileAttribution │
│ request_log_id  │
│ file_path       │
│ tool_type       │ (edit/write/read)
│ attempt_count   │
│ token_cost      │
└─────────────────┘

┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ ModelAlias   │  │ Pricebook        │  │    Package       │
│ alias, proto │  │ id, version      │  │ id, name         │
│ fallback     │  │ model, prices    │  │ credit_quota     │
│ → ChannelPool│  │ std/cost prices  │  │ split_ratio      │
└──────────────┘  │ context_window   │  │ overage_price    │
                  └──────────────────┘  │ passthrough_price│
                                        │ model_scope      │
                                        │ pricebook_ver    │
                                        └────────┬─────────┘
                                                 │ 1:N
                                        ┌────────▼─────────┐
                                        │  Subscription    │
                                        │ customer_id      │
                                        │ package_id       │
                                        │ period           │
                                        │ credits_used     │
                                        │ status           │
                                        └────────┬─────────┘
                                                 │ 1:N
                                        ┌────────▼─────────┐
                                        │     Bill         │
                                        │ subscription_id  │
                                        │ period           │
                                        │ items[]          │
                                        │ total, cost      │
                                        │ profit           │
                                        └──────────────────┘
```

### 2.2 核心实体定义

**组织与认证：**

| 表 | 关键字段 | 说明 |
|---|---|---|
| `tenants` | id, name, mode (saas/single) | SaaS 每客户一行；单一企业固定单行 |
| `organizations` | id, tenant_id, name, settings | 企业实体 |
| `teams` | id, org_id, name, budget_limit | 团队，归属企业 |
| `projects` | id, team_id, name, description, data_mode | 项目，VK 绑定目标 |
| `virtual_keys` | id (fab-xxx), project_id, budget_limit, rpm_limit, tpm_limit, concurrency_limit, model_scope (JSONB), pool_group, expires_at, ip_whitelist, status | 虚拟密钥 |
| `api_credentials` | id, vk_id, hashed_secret | VK 的认证凭据（哈希存储） |

**Provider 与渠道：**

| 表 | 关键字段 | 说明 |
|---|---|---|
| `providers` | id, name, protocol (openai/anthropic/vllm), base_url, status | Provider 注册 |
| `provider_keys` | id, provider_id, encrypted_key (AES-256), status, quota_limit, last_used_at | Provider API Key（加密） |
| `channels` | id, provider_id, key_id, model, weight, priority, pool_id, status | 渠道 = Provider + Key + 模型 + 权重 |
| `channel_pools` | id, name, group (premium/standard/bulk), rpm_cap, tpm_cap | 渠道池 |
| `model_aliases` | id, alias, protocol, pool_id, fallback_alias | 模型别名 → 渠道池 → Fallback |
| `routing_rules` | id, org_id, strategy_flags (JSONB), retry_count, backoff, retry_status_codes | 路由策略配置 |

**计量与成本：**

| 表 | 关键字段 | 说明 |
|---|---|---|
| `runs` | id, vk_id, project_id, task_type, started_at, ended_at, status, total_cost, total_tokens | 一次 Run（可含多个请求） |
| `request_logs` | id, run_id, vk_id, provider, model, channel_id, input_tokens, output_tokens, cached_tokens, cost, latency_ms, status_code, route_decision (JSONB), fabric_context (JSONB), created_at | 单次请求日志 |
| `token_breakdowns` | id, request_log_id, token_type, direction, count, weight, cache_factor, cost | Token 分类明细 |
| `file_attributions` | id, request_log_id, file_path, tool_type, attempt_count, token_cost | 文件级成本归因 |
| `usage_records` | id, project_id, team_id, org_id, period, model, input_tokens, output_tokens, cost, waste_cost | 聚合用量（按周期） |

**预算：**

| 表 | 关键字段 | 说明 |
|---|---|---|
| `budgets` | id, scope_type (org/team/project/vk), scope_id, period (monthly), limit_amount, used_amount, soft_limit_pct, hard_limit_pct, status | 预算账户 |
| `budget_reservations` | id, budget_id, run_id, amount, consumed, status (pending/executing/released) | 预算预占 |

**定价与计费：**

| 表 | 关键字段 | 说明 |
|---|---|---|
| `pricebooks` | id, version, currency, status (active/archived), effective_from | 价格表版本 |
| `pricebook_entries` | id, pricebook_id, model, standard_input_price, standard_output_price, standard_cache_price, cost_input_price, cost_output_price, cost_cache_price, context_window | 每模型一行价格 |
| `credit_multipliers` | id, version, model, input_multiplier, output_multiplier | Credit 倍率表 |
| `packages` | id, name, credit_quota, price, period, split_ratio, overage_unit_price, passthrough_unit_price, model_scope (JSONB), pricebook_version | 套餐定义 |
| `subscriptions` | id, tenant_id, package_id, period_start, period_end, credits_used, credits_remaining, status | 客户订阅 |
| `bills` | id, subscription_id, period, items (JSONB), total_amount, cost_amount, profit, status | 账单 |

**治理：**

| 表 | 关键字段 | 说明 |
|---|---|---|
| `users` | id, tenant_id, org_id, role (super_admin/org_admin/team_admin/developer), email, status | 目标模型。现行表是 `operators`，role 无 super_admin |
| `audit_logs` | id, actor_id, action, target_type, target_id, detail (JSONB), created_at | 审计日志 |
| `data_retention_policies` | id, project_id, mode (full/redacted/metadata/zero/local), ttl_days, archive_enabled, legal_hold | 数据保存策略 |

### 2.3 存储策略

| 数据类型 | 存储 | 保留策略 | 查询模式 |
|---|---|---|---|
| 配置数据（Provider/渠道/路由/VK/预算/Pricebook） | PostgreSQL | 永久（版本化） | 按 ID 查询、列表分页 |
| 热状态（限流计数器/预算余额/渠道健康/熔断状态） | Redis | 实时（TTL 轮转） | 原子读写（Lua 脚本） |
| 请求日志（元数据） | ClickHouse | 按项目 TTL | 时序聚合、下钻查询 |
| 请求/响应正文 | S3 兼容 | 按项目 data_mode + TTL | 按需检索（Run Explorer） |
| 审计日志 | PostgreSQL + ClickHouse | 永久（合规） | 按时间/操作/对象查询 |
| 聚合用量 | ClickHouse | 按项目 TTL | ROI 趋势、模型对比 |

> **ClickHouse 分区策略**：`request_logs` 按 `toYYYYMM(created_at)` 分区，便于按月清理过期数据。`token_breakdowns` 和 `file_attributions` 按 `request_log_id` 关联，存储在同一 ClickHouse 集群。

---

## 3. 网关层设计

### 3.1 请求处理流程

```text
客户端请求
    │
    ▼
┌───────────┐     失败    ┌──────────────────┐
│ 1. Auth   │────────────►│ 401 Unauthorized │
│    & VK   │             └──────────────────┘
│ 解析 VK   │
│ 验证签名  │
└─────┬─────┘
      │ 成功
      ▼
┌───────────┐     超限    ┌──────────────────┐
│ 2. Rate   │────────────►│ 429 rate_limited │
│    Limit  │             └──────────────────┘
│ 检查 4 维 │
│ 限流配额  │
└─────┬─────┘
      │ 通过
      ▼
┌───────────┐     硬限制  ┌──────────────────┐
│ 3. Budget │────────────►│ 402 budget_      │
│    Check  │             │    exceeded      │
│ 预算预占  │ 软限制      └──────────────────┘
│ (P90估算) │────────────►│ 200 + 响应头
│           │             │ x-fabric-soft-
└─────┬─────┘             │   limit: true
      │ 通过              └──────────────────┘
      ▼
┌───────────┐
│ 4. Route  │
│    Engine │
│ 模型别名  │
│ → 渠道池  │
│ → 选渠道  │
└─────┬─────┘
      │ 选定渠道
      ▼
┌───────────┐     Provider ┌──────────────────┐
│ 5. Proxy  │────错误─────►│ 重试 / Fallback  │
│    (SSE)  │             │ (同模型换渠道,   │
│ 透传请求  │             │  或同协议换模型) │
│ 透传响应  │             └────────┬─────────┘
└─────┬─────┘                      │
      │ 响应完成                    │ 重试成功
      ▼                             │
┌───────────┐◄──────────────────────┘
│ 6. Meter  │
│    Async  │
│ 解析 usage│
│ 分类 Token│
│ 归因文件  │
│ 记录成本  │
│ 释放预占  │
│ 检测浪费  │
└───────────┘
```

**关键设计：**

| 阶段 | 同步/异步 | 延迟预算 | 失败处理 |
|---|---|---|---|
| Auth & VK | 同步 | < 1ms | 拒绝请求 |
| Rate Limit | 同步 | < 2ms (Redis) | 返回 429 |
| Budget Check | 同步 | < 5ms (Redis) | 返回 402 或加响应头 |
| Route Engine | 同步 | < 5ms (内存) | 回退到默认渠道 |
| Proxy (SSE) | 同步流式 | — | 重试/Fallback |
| Meter Async | 异步 | 不计入响应延迟 | 重试队列，最终一致 |

> **网关总开销目标**：P99 < 50ms（不含 Provider 响应）。Auth + Rate + Budget + Route 四步合计 < 15ms。

### 3.2 双端点零转换

```text
┌─────────────────────────────────────────────────────────────────┐
│                    Fabric Gateway HTTP 路由                      │
│                                                                 │
│  POST /v1/chat/completions    ──►  OpenAI Proxy Handler       │
│  POST /v1/messages            ──►  Anthropic Proxy Handler    │
│  POST /v1/embeddings          ──►  Embedding Proxy Handler    │
│  (其他路径)                    ──►  404                         │
│                                                                 │
│  共享中间件链:                                                   │
│  Auth → RateLimit → Budget → [Protocol-Specific Proxy] → Meter │
└─────────────────────────────────────────────────────────────────┘
```

| 端点 | 协议 | 路由到 | 请求体处理 | 响应体处理 |
|---|---|---|---|---|
| `/v1/chat/completions` | OpenAI | OpenAI / Azure / vLLM | 透传（仅读取 `model` 做路由） | 透传（仅读取 `usage` 做计量） |
| `/v1/messages` | Anthropic | Anthropic / Bedrock Claude | 透传（仅读取 `model`） | 透传（仅读取 `usage`） |
| `/v1/embeddings` | OpenAI | OpenAI / 兼容 Provider | 透传 | 透传 |

**实现要点：**

1. **不修改请求体** — 只解析必要字段（`model`、`stream`、`fabric_context` from header），不增删改字段
2. **不修改响应体** — 只解析 `usage` 对象做计量，原样转发给客户端
3. **Header 处理** — 注入 `x-fabric-request-id`（追踪用）；透传 Provider 限流头（`x-ratelimit-*`）
4. **`fabric_context`** — 通过 `x-fabric-context` 请求头传递，不污染请求体；JSON 格式，含 `project_id`、`task_type`、`preferences`

```go
// 伪代码：OpenAI Proxy Handler
func openAIProxyHandler(w http.ResponseWriter, r *http.Request) {
    body := readBody(r)                    // 读取请求体（不修改）

    // 1. 解析必要字段（不修改 body）
    var req struct {
        Model string `json:"model"`
        Stream bool   `json:"stream"`
    }
    json.Unmarshal(body, &req)

    // 2. 从 header 读取 fabric_context
    ctx := parseFabricContext(r.Header.Get("x-fabric-context"))

    // 3-4. Auth + RateLimit + Budget（中间件链已处理）

    // 5. 路由：model alias → channel pool → 选渠道
    channel := routeEngine.Select(req.Model, ctx)

    // 6. 透传到 Provider
    providerReq := newHTTPRequest("POST", channel.Provider.URL, body)
    providerReq.Header.Set("Authorization", "Bearer "+channel.Key.Decrypt())
    providerReq.Header.Set("Content-Type", "application/json")

    // 7. 流式透传响应
    if req.Stream {
        proxySSE(w, providerReq, func(usage *Usage) {
            // 8. 流结束后异步计量
            meteringQueue <- MeteringEvent{Usage: usage, Channel: channel, Ctx: ctx}
        })
    } else {
        resp := doRequest(providerReq)
        writeResponse(w, resp)  // 原样写回
        meteringQueue <- MeteringEvent{Usage: parseUsage(resp), Channel: channel, Ctx: ctx}
    }
}
```

### 3.3 路由引擎

```text
请求 model="gpt-4", task_type="coding"
    │
    ▼
┌──────────────────┐
│ Step 1: 别名解析  │
│ "gpt-4" → pool_id │
│ + fallback="gpt-4o"│
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Step 2: 渠道选择  │
│ 查 pool 中健康渠道 │
│ 按 priority 分组  │
│ 同 priority 按权重 │
│ 加权随机选一个    │
└────────┬─────────┘
         │
    ┌────┴────┐
    │ 选定渠道 │
    └────┬────┘
         │
         ▼
┌──────────────────┐     成功      ┌──────────┐
│ Step 3: 执行请求  │──────────────►│ 透传响应  │
│ 转发到 Provider   │              └──────────┘
└────────┬─────────┘
         │ 失败 (429/5xx)
         ▼
┌──────────────────┐
│ Step 4: 重试      │
│ 同模型换渠道      │
│ (retry_count 次)  │
└────────┬─────────┘
         │ 全部重试失败
         ▼
┌──────────────────┐     有 fallback     ┌──────────┐
│ Step 5: Fallback │────────────────────►│ 回到Step1│
│ 切到 fallback模型 │                     │ (新模型) │
│ (仅同协议内)      │                     └──────────┘
└────────┬─────────┘
         │ 无 fallback
         ▼
┌──────────────────┐
│ Step 6: 返回 503  │
│ provider_         │
│ unavailable       │
└──────────────────┘
```

**渠道选择算法（加权随机）：**

```text
给定 priority=1 的健康渠道列表:
  channel_A: weight=60
  channel_B: weight=40

总权重 = 100
随机数 r = random(0, 100)

r < 60 → 选 channel_A
r ≥ 60 → 选 channel_B
```

**路由配置缓存：**

| 数据 | 存储 | 刷新机制 |
|---|---|---|
| 模型别名 → 渠道池映射 | Gateway 内存 | PostgreSQL 变更 → Redis Pub/Sub → 网关刷新 |
| 渠道列表 + 权重 + 优先级 | Gateway 内存 | 同上 |
| 渠道健康状态 | Redis（实时更新） | 网关每次请求后更新滑动窗口 |
| 路由策略开关 | Gateway 内存 | 同上 |

### 3.4 渠道池化

**渠道健康监控（滑动窗口）：**

```text
每个渠道在 Redis 维护一个滑动窗口:
  key: channel:{id}:health
  value: 最近 N=100 次请求的成功/失败位图

成功率 = success_count / total_count
  ≥ 80% → 健康 (healthy)
  < 80% → 禁用 (disabled) → 流量转移到同池其他渠道

禁用后:
  每隔 30s 发送探测请求
  探测成功 → 恢复 (healthy)
  探测失败 → 保持禁用
```

**池级容量聚合：**

```text
pool_aggregated_rpm = Σ(healthy_channels.rpm_limit)
pool_aggregated_tpm = Σ(healthy_channels.tpm_limit)
pool_available_channels = count(healthy_channels) / count(total_channels)
```

> 所有聚合值实时计算（Redis ZSET），不落盘。Admin API 读取时从 Redis 查询。

### 3.5 限流

**四维令牌桶（Redis Lua 原子操作）：**

```text
检查顺序（从细到粗）:
  1. per-api-key:  VK 的 RPM/TPM 限制
  2. per-project:   项目的限制
  3. per-team:      团队的限制
  4. per-provider:  Provider 合同限制

任一维度超限 → 429 rate_limited

令牌桶参数:
  capacity = limit × burst_factor (默认 1.2, 允许 20% 突发)
  refill_rate = limit / 60 (每秒补充)

Redis Lua 脚本（原子操作）:
  -- 1. 检查并扣减令牌
  -- 2. 返回剩余令牌和是否允许
```

| 策略 | 实现 | 适用场景 |
|---|---|---|
| 硬拒绝 | 令牌桶耗尽 → 429 | 默认策略 |
| 排队 | 超限进入 Redis 队列，等待令牌补充 | 批处理任务 |
| 降级 | 超限切到更便宜的模型（需配置替代模型） | 非关键任务 |
| 突发容忍 | 令牌桶 capacity > limit | 允许短时突发 |

### 3.6 熔断与健康检查

```text
熔断状态机:

    ┌──────────┐  错误率 > 阈值    ┌──────────┐
    │  CLOSED  │─────────────────►│   OPEN   │
    │ (正常)   │                   │ (熔断)   │
    └──────────┘                   └────┬─────┘
         ▲                              │
         │ 探测成功                      │ 等待 30s
         │                              ▼
         │                        ┌──────────┐
         └────────────────────────│HALF-OPEN │
                                  │ (半开)   │
                                  └────┬─────┘
                                       │ 探测失败
                                       ▼
                                  回到 OPEN
```

| 参数 | 默认值 | 存储 |
|---|---|---|
| 错误率阈值 | 20% (滑动窗口 100 次) | Redis |
| P99 延迟阈值 | 5000ms | Redis |
| 熔断持续时间 | 30s → 半开 | Redis TTL |
| 半开探测请求数 | 3 | Redis 计数器 |

**主动探测：** 后台 goroutine 每 60s 向每个 Provider 发送轻量请求（如 `/v1/models`），更新健康状态。

### 3.7 缓存

| 缓存类型 | 实现 | 命中条件 | TTL |
|---|---|---|---|
| Prompt Cache | 透传 Provider 的 prompt caching | Provider 原生支持（如 Anthropic） | Provider 控制 |
| 响应缓存 | Redis: hash(request_body) → response | 相同请求 + 确定性任务 | 可配（默认 1h） |
| 配置缓存 | Gateway 内存: 路由/限流/预算配置 | PostgreSQL 变更触发刷新 | 实时（Pub/Sub） |

> **响应缓存仅对确定性任务启用**：`fabric_context.preferences.cacheable = true` 时才查缓存。默认不缓存（LLM 响应通常不具确定性）。

### 3.8 流式透传

```text
┌─────────┐                 ┌─────────┐                ┌─────────┐
│ Client  │                 │ Gateway │                │ Provider │
└────┬────┘                 └────┬────┘                └────┬────┘
     │ POST (stream:true)       │                           │
     │──────────────────────────>│                          │
     │                          │ POST (stream:true)         │
     │                          │──────────────────────────>│
     │                          │                           │
     │                          │   SSE: data: {chunk1}     │
     │   SSE: data: {chunk1}    │<──────────────────────────│
     │<──────────────────────────│                          │
     │                          │   SSE: data: {chunk2}     │
     │   SSE: data: {chunk2}    │<──────────────────────────│
     │<──────────────────────────│                          │
     │                          │   SSE: data: [DONE]       │
     │                          │   + usage object          │
     │   SSE: data: [DONE]      │<──────────────────────────│
     │<──────────────────────────│                          │
     │                          │                           │
     │                          │ ──► 异步计量              │
     │                          │     (usage from last chunk)│
```

**关键实现：**

1. **不缓冲** — 每收到一个 SSE chunk 立即转发给客户端，零缓冲
2. **Token 估算** — 流式过程中用 tokenizer 估算已输出 Token 数，用于预算监控（非精确）
3. **最终计量** — 流式结束后，从最后一个 chunk 的 `usage` 对象获取精确 Token 数
4. **中断处理** — 客户端断开 → cancel Provider context；Provider 断开 → 发送 `data: [ERROR]` 给客户端
5. **无 usage 回退** — Provider 未返回 usage 时，用流式估算值（标记 `estimated: true`）

---

## 4. 计量层设计

### 4.1 Token 分类器

```text
请求/响应 JSON
    │
    ▼
┌────────────────────────────────────────────────────────┐
│                 Token Classifier                        │
│                                                        │
│  输入分类 (messages[]):                                │
│  ┌──────────────────────────────────────────────────┐  │
│  │ role=system    → System Prompt (weight=0.3)     │  │
│  │ role=user      → User Query (weight=1.0)        │  │
│  │ role=assistant → Context (weight=0.5)            │  │
│  │ role=tool      → Tool Result (weight=0.2)        │  │
│  │ content[].type="image" → Injected (weight=0.4)  │  │
│  │ (文件/仓库内容注入到 messages 中)                  │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  输出分类 (choices[].message / content[]):             │
│  ┌──────────────────────────────────────────────────┐  │
│  │ content (text)    → Final Output (weight=1.0)   │  │
│  │ tool_calls        → Tool Call (weight=0.5)       │  │
│  │ reasoning_content → Thinking (weight=0.3)        │  │
│  │ structured output → Structured (weight=0.6)      │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  缓存因子:                                              │
│  ┌──────────────────────────────────────────────────┐  │
│  │ usage.prompt_tokens_details.cached_tokens > 0   │  │
│  │   → cached 部分 cache_factor=0.1                 │  │
│  │ 其余 → cache_factor=1.0                          │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

**分类逻辑（伪代码）：**

```python
def classify_tokens(request, response_usage):
    breakdown = []

    # 输入 Token 分类
    for msg in request["messages"]:
        role = msg["role"]
        if role == "system":
            token_type = "system_prompt"
            weight = 0.3
        elif role == "user":
            token_type = "user_query"
            weight = 1.0
        elif role == "assistant":
            token_type = "context"
            weight = 0.5
        elif role == "tool":
            token_type = "tool_result"
            weight = 0.2

        # 估算该 message 的 token 数（用 tokenizer）
        count = estimate_tokens(msg["content"])
        breakdown.append(TokenBreakdown(
            token_type=token_type, direction="input",
            count=count, weight=weight, cache_factor=1.0
        ))

    # 输出 Token 分类（从 response 解析）
    output_tokens = response_usage["completion_tokens"]
    if "reasoning_tokens" in response_usage:
        # Thinking 部分
        breakdown.append(TokenBreakdown(
            token_type="thinking", direction="output",
            count=response_usage["reasoning_tokens"], weight=0.3
        ))
        output_tokens -= response_usage["reasoning_tokens"]

    # 剩余 output 按 Final Output 分类（简化：V1 全部计为 final_output）
    breakdown.append(TokenBreakdown(
        token_type="final_output", direction="output",
        count=output_tokens, weight=1.0
    ))

    # 缓存因子
    cached = response_usage.get("prompt_tokens_details", {}).get("cached_tokens", 0)
    if cached > 0:
        # 找到 system_prompt 部分，拆分为 cached 和 uncached
        apply_cache_factor(breakdown, "system_prompt", cached, 0.1)

    return breakdown
```

> **V1 限制**：输出 Token 分类依赖 Provider 返回的 `usage` 细分。OpenAI 不返回 `reasoning_tokens`（o1 系列除外），Anthropic 返回 `cache_creation_input_tokens` 和 `cache_read_input_tokens`。分类器按 Provider 能力做最佳努力分类。

### 4.2 文件级成本归因

```text
响应中的 tool_calls
    │
    ▼
┌─────────────────────────────────────────────┐
│          File Attributor                     │
│                                             │
│  解析 tool_calls[].function.arguments       │
│  提取文件路径:                                │
│    - edit:   arguments.path                 │
│    - write:  arguments.path                 │
│    - read:   arguments.path                 │
│    - bash:   arguments.command (正则提取)   │
│                                             │
│  归因计算:                                   │
│    该请求的 cost × (tool_call_tokens /       │
│                      total_output_tokens)   │
│    = 文件归因成本                            │
│                                             │
│  重试检测:                                   │
│    同一 file_path 多次 edit → attempt_count++│
│    attempt_count > 1 → 标记为重试浪费        │
└─────────────────────────────────────────────┘
```

**归因算法：**

```text
给定一次请求:
  total_cost = ¥2.00
  total_output_tokens = 500
  tool_calls:
    [0] edit "src/auth/login.py"  → 200 tokens
    [1] edit "src/auth/utils.py"  → 100 tokens
    [2] (无 tool_call, 纯文本)    → 200 tokens

文件归因:
  src/auth/login.py: ¥2.00 × (200/500) = ¥0.80
  src/auth/utils.py: ¥2.00 × (100/500) = ¥0.40
  (推理/分析):       ¥2.00 × (200/500) = ¥0.80
```

> **限制**：仅支持 OpenAI/Anthropic 标准工具调用格式。纯文本输出（无 tool_calls）的文件映射需 Runtime 报告。各 Agent 框架自定义工具 schema 不在 V1 范围内。

### 4.3 四套账本

| 账本 | 数据源 | 写入时机 | 存储位置 |
|---|---|---|---|
| **用量账** | Token 分类结果 | 每次请求完成后 | ClickHouse `token_breakdowns` |
| **容量账** | Redis 限流计数器 + 渠道健康状态 | 实时 | Redis（快照定时落 ClickHouse） |
| **经济账** | Pricebook 成本价 × Token 用量 | 每次请求完成后 | ClickHouse `request_logs.cost` |
| **结果账** | 请求状态 + 浪费检测结果 | 请求完成 + 浪费检测后 | ClickHouse `request_logs` + `waste_records` |

### 4.4 预算引擎

```text
┌──────────────────────────────────────────────────────────────┐
│                    Budget Engine (Redis)                      │
│                                                              │
│  数据结构:                                                    │
│    budget:{budget_id}:balance    → 当前余额 (float)          │
│    budget:{budget_id}:reserved   → 已预占 (float)            │
│    budget:{budget_id}:consumed   → 已消耗 (float)            │
│                                                              │
│  预算检查流程 (Lua 原子操作):                                  │
│    1. 查找 Budget Waterfall:                                  │
│       project_budget → team_budget → org_budget              │
│    2. 检查可用余额 = balance - reserved                       │
│    3. 预估请求成本 (P90 历史):                                │
│       estimated = P90(model, task_type) × price              │
│    4. 预占:                                                  │
│       if available >= estimated:                             │
│         reserved += estimated                                │
│         return OK + reservation_id                           │
│       elif available > 0:                                    │
│         # 预占剩余余额                                        │
│         reserved += available                                │
│         return SOFT_LIMIT                                    │
│       else:                                                  │
│         return HARD_LIMIT (402)                              │
│                                                              │
│  结算流程:                                                    │
│    1. 请求完成，实际成本 = actual_cost                        │
│    2. 释放预占: reserved -= estimated                        │
│    3. 扣减实际: consumed += actual_cost                      │
│    4. 更新余额: balance -= actual_cost                       │
│                                                              │
│  软限制检查:                                                  │
│    if consumed / limit >= 0.8:                               │
│      → 触发告警 (Webhook + 仪表盘)                           │
│    if consumed / limit >= 1.0:                               │
│      → 拒绝新请求 (402)                                      │
└──────────────────────────────────────────────────────────────┘
```

**Budget Waterfall 查找逻辑：**

```text
给定 VK → project_id:
  1. 查 project_budget (budgets WHERE scope_type='project' AND scope_id=project_id)
     → 可用余额 = balance - reserved
     → if 余额充足: 使用 project budget
  2. else 查 team_budget (scope_type='team' AND scope_id=team_id)
     → if 余额充足: 使用 team budget (项目预算不足部分下溢到团队)
  3. else 查 org_budget (scope_type='org' AND scope_id=org_id)
     → if 余额充足: 使用 org budget
  4. else: 返回 HARD_LIMIT
```

### 4.5 浪费检测

```text
┌─────────────────────────────────────────────────────────────┐
│                 Waste Detector (异步批处理)                   │
│                                                             │
│  触发: 每次请求完成后（异步）或定时聚合（每小时）              │
│  方法: 精确匹配 + 启发式规则（不调用 LLM）                   │
│                                                             │
│  检测项:                                                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ 1. Retry Amplification                                │  │
│  │    同一 file_path 多次 edit → 重试                    │  │
│  │    amplification = actual_calls / success_steps       │  │
│  │                                                       │  │
│  │ 2. Loop Factor                                        │  │
│  │    相同 messages hash 重复出现 → 循环                  │  │
│  │    loop_count = duplicate_hashes / total_requests     │  │
│  │                                                       │  │
│  │ 3. Context Redundancy                                 │  │
│  │    输入 Token 中重复上下文占比                         │  │
│  │    redundancy = duplicate_context_tokens / input_total│  │
│  │                                                       │  │
│  │ 4. Unproductive Spend                                 │  │
│  │    失败(5xx)/取消/未验证结果的成本                     │  │
│  │    unproductive = sum(cost WHERE status != success)   │  │
│  │                                                       │  │
│  │ 5. Cache Miss Rate                                    │  │
│  │    未命中缓存 / 总缓存候选                             │  │
│  │    miss_rate = cache_miss / cache_candidates          │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  输出: waste_records 表 (ClickHouse)                         │
│    request_log_id, waste_type, waste_cost, detail           │
└─────────────────────────────────────────────────────────────┘
```

### 4.6 ROI 计算

```text
Token ROI 计算 (定时聚合, 存 ClickHouse):

  -- 按模型 × 任务类型聚合
  SELECT
    model,
    task_type,
    SUM(CASE WHEN weight >= 0.3 THEN cost ELSE 0 END) / SUM(cost) AS token_roi,
    SUM(CASE WHEN weight < 0.3 THEN cost ELSE 0 END) / SUM(cost) AS low_value_ratio,
    SUM(waste_cost) / SUM(cost) AS waste_ratio
  FROM request_logs r
  JOIN token_breakdowns t ON r.id = t.request_log_id
  WHERE r.created_at >= {period_start}
  GROUP BY model, task_type

  -- 按团队/项目聚合
  SELECT
    team_id, project_id,
    SUM(CASE WHEN weight >= 0.3 THEN cost ELSE 0 END) / SUM(cost) AS token_roi,
    ...
  GROUP BY team_id, project_id
```

**ROI 优化路由推荐（bandit 算法）：**

```text
定时任务（每小时）:
  1. 查历史: SELECT model, AVG(token_roi), AVG(success_rate), COUNT(*)
             FROM roi_aggregations
             WHERE task_type = {type}
             GROUP BY model
  2. 计算: ExpectedROI(M) = AVG(token_roi) × AVG(success_rate)
  3. 排序: 按 ExpectedROI 降序
  4. 写入: route_recommendations 表
  5. 路由时: 新请求带 task_type → 查推荐 → 推荐最优模型

  安全约束:
    - 只推荐调用者有权使用的模型（检查 model_scope）
    - 只推荐满足上下文长度要求的模型
    - 历史样本数 < N (默认 1000) → 回退简单路由
    - 所有决策记录理由（route_decision JSONB）
```

---

## 5. 定价与计费设计

### 5.1 Pricebook

```text
┌─────────────────────────────────────────────────────────────┐
│                    Pricebook 管理                             │
│                                                             │
│  Pricebook (版本化)                                          │
│    └── PricebookEntry (每模型一行)                           │
│          ├── standard_input_price   (标准输入价)             │
│          ├── standard_output_price  (标准输出价)             │
│          ├── standard_cache_price   (标准缓存价)             │
│          ├── cost_input_price       (成本输入价)             │
│          ├── cost_output_price      (成本输出价)             │
│          ├── cost_cache_price       (成本缓存价)             │
│          └── context_window         (最大上下文)              │
│                                                             │
│  版本管理:                                                   │
│    - 价格变更 → 创建新版本 (v2024.04)                       │
│    - 历史请求按当时版本计价                                  │
│    - 套餐周期内锁定价格版本                                  │
│    - 新请求按最新版本                                        │
│                                                             │
│  计价一致性约束:                                             │
│    standard_price = multiplier × credit_unit_price          │
│    修改倍率或 Credit 单价时，标准价自动派生                  │
│    防止两处不一致导致套利或多收                               │
└─────────────────────────────────────────────────────────────┘
```

**请求计价流程：**

```text
请求完成 → 获取 usage (input_tokens, output_tokens, cached_tokens)
    │
    ▼
查找 Pricebook 版本:
  SaaS: subscription.pricebook_version
  单一企业: 当前 active 版本
    │
    ▼
计算标准价成本 (客户计费):
  standard_cost = input_tokens × standard_input_price
                + output_tokens × standard_output_price
                + cached_tokens × standard_cache_price
    │
    ▼
计算成本价成本 (内部核算):
  actual_cost = input_tokens × cost_input_price
              + output_tokens × cost_output_price
              + cached_tokens × cost_cache_price
    │
    ▼
利润 = standard_cost - actual_cost
```

### 5.2 AI Credit

```text
Credit 计算:
  AI Credits = Σ(input_tokens × input_multiplier × cache_factor)
             + Σ(output_tokens × output_multiplier)

  cache_factor: 命中缓存 = 0.1, 未命中 = 1.0

倍率表 (版本化, 与 Pricebook 独立):
  ┌──────────────┬───────────────┬────────────────┐
  │ 模型          │ 输入倍率      │ 输出倍率        │
  ├──────────────┼───────────────┼────────────────┤
  │ GPT-4o       │ 1.0           │ 1.0            │
  │ GPT-4        │ 3.0           │ 6.0            │
  │ Claude Sonnet│ 1.5           │ 3.0            │
  │ Claude Haiku │ 0.5           │ 1.0            │
  │ GPT-3.5      │ 0.3           │ 0.6            │
  └──────────────┴───────────────┴────────────────┘

  版本管理: 倍率变更 → 新版本
            已有套餐锁定购买时版本
            续费时切换到最新版本
```

### 5.3 套餐与三层计量

```text
┌──────────────────────────────────────────────────────────────┐
│                   三层计量引擎 (实时, Redis)                   │
│                                                              │
│  数据结构:                                                    │
│    subscription:{id}:credits_used      → 已用 Credits        │
│    subscription:{id}:credits_remaining → 剩余 Credits        │
│    subscription:{id}:overage_credits   → 超额区 Credits      │
│    subscription:{id}:passthrough_tokens→ 透传区 Token        │
│                                                              │
│  请求计费流程 (Lua 原子操作):                                  │
│    credits_needed = calculate_credits(usage, multiplier)     │
│    split_point = quota × split_ratio / 100                   │
│                                                              │
│    if credits_used < split_point:                            │
│      # 订阅额度内                                             │
│      credits_used += credits_needed                          │
│      extra_charge = 0                                        │
│                                                              │
│    elif credits_used < quota:                                │
│      # 超额收费区                                             │
│      credits_used += credits_needed                          │
│      extra_charge = credits_needed × overage_unit_price      │
│                                                              │
│    else:                                                     │
│      # 透传区 (不扣 Credits)                                  │
│      passthrough_tokens += actual_tokens                    │
│      extra_charge = actual_tokens × passthrough_unit_price   │
│                                                              │
│      # 风控检查                                               │
│      if passthrough_charge > quota_price × 3:                │
│        return 402 (熔断)                                     │
│                                                              │
│    return OK + tier (subscription/overage/passthrough)       │
└──────────────────────────────────────────────────────────────┘
```

### 5.4 账单生成

```text
定时任务 (每月 1日):
  FOR EACH subscription WHERE status = 'active':
    1. 汇总当月用量:
       - 订阅额度内 Credits + 超额 Credits + 透传 Tokens
       - 按模型分布
       - 缓存节省
    2. 计算费用:
       - 套餐费 (固定)
       - 超额费 = 超额 Credits × overage_unit_price
       - 透传费 = 透传 Tokens × passthrough_unit_price
    3. 计算成本:
       - API 成本 = Σ(actual_cost per request)
    4. 计算利润:
       - 毛利润 = 总收入 - API 成本
    5. 生成 Bill 记录
    6. 发送通知 (Webhook + 邮件)
```

**退费/冲正：**

```text
失败请求 (Provider 5xx):
  → 退还 Credits (credits_used -= credits_needed)
  → 记录退费在结果账
  → 不修改原流水，追加 Adjustment 记录

取消请求 (客户端中断):
  → 按已消耗 Token 扣 Credits (不退)
  → 标记 status = 'cancelled'
```

---

## 6. 治理层设计

### 6.1 RBAC 与多租户

现行控制台不实现 `super_admin`，也不按 `tenant_id` 过滤。落地权限是 session 里的三角色 + `team_id`。

```text
┌──────────────────────────────────────────────────────────────┐
│                    RBAC 权限模型                               │
│                                                              │
│  角色 (4 种):                                                 │
│    super_admin    → 仅 SaaS, 管理所有 Tenant                 │
│    org_admin      → 管理本 Organization                      │
│    team_admin     → 管理本 Team                              │
│    developer      → 管理自己的 VK                            │
│                                                              │
│  数据范围过滤 (SQL 级别):                                     │
│    super_admin:  无过滤 (看所有 Tenant)                      │
│    org_admin:    WHERE org_id = {user.org_id}               │
│    team_admin:   WHERE team_id IN (teams of user)           │
│    developer:    WHERE project_id IN (projects of user's VK)│
│                                                              │
│  权限矩阵:                                                    │
│    每个界面 = 资源类型 × 操作 (view/create/edit/delete)       │
│    权限检查: user.role + resource.scope → allow/deny         │
│    实现: PostgreSQL RLS (Row Level Security) 或应用层过滤     │
│                                                              │
│  多租户隔离 (SaaS):                                           │
│    每个表都有 tenant_id 字段                                  │
│    super_admin 可跨 tenant 查询                              │
│    其他角色自动过滤 tenant_id = {user.tenant_id}             │
│    单一企业: 所有数据 tenant_id = 1 (固定)                    │
└──────────────────────────────────────────────────────────────┘
```

**导航可见性逻辑：**

```text
用户登录 → 确定角色 + 部署模式 + 是否配置外部 API
  │
  ├─ super_admin (SaaS):
  │    → 全部 17 个界面可见
  │
  ├─ org_admin (单一企业 + 外部 API):
  │    → 全部 17 个界面可见（含 12-14 定价与计费）
  │
  ├─ org_admin (单一企业 + 仅自建):
  │    → 14 个界面（无 12-14）
  │
  ├─ team_admin:
  │    → 11 + 15-17（无 2,3,9,11 管理功能, 无 12-14）
  │
  └─ developer:
       → 1,4-8,10,15,16（自己的数据范围）
```

### 6.2 Virtual Key 生命周期

```text
┌─────────────────────────────────────────────────────────┐
│                 VK 生命周期状态机                        │
│                                                         │
│  ┌────────┐  审批通过   ┌────────┐  到期   ┌────────┐  │
│  │pending │────────────►│active  │────────►│expired │  │
│  └───┬────┘             └──┬─────┘         └────────┘  │
│      │ 审批拒绝              │ 手动暂停                  │
│      ▼                      ▼                           │
│  ┌────────┐             ┌────────┐                      │
│  │rejected│             │paused  │                      │
│  └────────┘             └──┬─────┘                      │
│                           │ 恢复                        │
│                           ▼                             │
│                        ┌────────┐  手动删除  ┌────────┐ │
│                        │active  │──────────►│deleted │ │
│                        └────────┘           └────────┘ │
└─────────────────────────────────────────────────────────┘

VK 申请流程:
  1. 开发者填写: 项目名(不可改)、描述、期望预算、模型范围、过期时间
  2. 提交 → team_admin 审批队列
  3. team_admin 审批:
     - 通过 → 生成 VK (fab-xxxx), 绑定 project, 状态=active
     - 拒绝 → 状态=rejected, 记录原因
  4. VK 明文仅显示一次（创建时），之后只显示 masked (fab-****-abcd)
  5. 项目名创建后不可修改（成本归因基础）

VK 轮换:
  - 自动轮换: 配置周期 (如 90 天), 到期前 7 天通知
  - 手动轮换: team_admin 触发, 旧 Key 宽限期 24h 后失效
  - 轮换期间新旧 Key 同时有效, 避免中断
```

### 6.3 数据保存与生命周期

```text
┌──────────────────────────────────────────────────────────┐
│                 数据保存架构                               │
│                                                          │
│  请求/响应正文:                                           │
│    Full       → S3 (加密), metadata → ClickHouse        │
│    Redacted   → S3 (脱敏), metadata → ClickHouse        │
│    Metadata   → 仅 ClickHouse (无正文)                   │
│    Zero       → 不落盘, 仅内存瞬态处理                    │
│    Local Only → 不上传, 客户端自管                        │
│                                                          │
│  生命周期:                                                │
│    热数据 (7天)   → ClickHouse 实时查询                   │
│    温数据 (30天)  → ClickHouse 压缩, 低频访问             │
│    冷数据 (1年+)  → S3 归档, 只读, 合规留存               │
│    TTL 过期      → 自动删除 (删除前可选审计快照)          │
│    Legal Hold    → 即使 TTL 到期也不删除                  │
│                                                          │
│  数据保存策略配置:                                        │
│    粒度: per-project                                     │
│    策略 Clamp: VK 策略 ≤ Project 策略 (只能更严格)       │
│    合规最短保留期: 不可缩短                               │
└──────────────────────────────────────────────────────────┘
```

---

## 7. API 契约

### 7.1 网关 API

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| POST | `/v1/chat/completions` | OpenAI 兼容，透传到 OpenAI 系 Provider | `Authorization: Bearer fab-xxx` |
| POST | `/v1/messages` | Anthropic 兼容，透传到 Anthropic 系 Provider | `x-api-key: fab-xxx` |
| POST | `/v1/embeddings` | Embedding 路由（V2） | `Authorization: Bearer fab-xxx` |
| GET | `/v1/models` | 返回可用模型列表（按 VK 权限过滤） | `Authorization: Bearer fab-xxx` |

**请求头：**

| Header | 说明 | 必填 |
|---|---|---|
| `Authorization` / `x-api-key` | Virtual Key | ✅ |
| `x-fabric-context` | JSON: `{project_id, task_type, preferences}` | ❌ |
| `Content-Type` | `application/json` | ✅ |

**响应头（Fabric 注入）：**

| Header | 说明 |
|---|---|
| `x-fabric-request-id` | 请求追踪 ID |
| `x-fabric-route` | 路由决策摘要（Provider, Channel, 是否 Fallback） |
| `x-fabric-soft-limit` | 软限制告警（值为 `true` 时触发） |
| `x-fabric-stale` | 降级响应标记（值为 `true` 时为缓存响应） |

### 7.2 管理 API

| 资源 | 方法 | 路径 | 角色 |
|---|---|---|---|
| Provider | GET/POST/PUT/DELETE | `/api/v1/providers` | super_admin, org_admin |
| Channel | GET/POST/PUT/DELETE | `/api/v1/providers/{id}/channels` | super_admin, org_admin |
| Channel Pool | GET/POST/PUT | `/api/v1/channel-pools` | super_admin, org_admin |
| Model Alias | GET/POST/PUT/DELETE | `/api/v1/model-aliases` | super_admin, org_admin |
| Routing Rules | GET/PUT | `/api/v1/routing-rules` | super_admin, org_admin |
| Virtual Key | GET/POST/PUT/DELETE | `/api/v1/virtual-keys` | super_admin, org_admin, team_admin |
| VK 申请 | POST/GET | `/api/v1/vk-applications` | developer (申请), team_admin (审批) |
| Budget | GET/POST/PUT | `/api/v1/budgets` | super_admin, org_admin, team_admin |
| Pricebook | GET/POST/PUT | `/api/v1/pricebooks` | super_admin, org_admin (单一企业) |
| Package | GET/POST/PUT | `/api/v1/packages` | super_admin, org_admin (单一企业) |
| Subscription | GET/POST/PUT | `/api/v1/subscriptions` | super_admin |
| Bill | GET | `/api/v1/bills` | super_admin, org_admin |
| Audit Log | GET | `/api/v1/audit-logs` | super_admin, org_admin, team_admin |
| Analytics | GET | `/api/v1/analytics/{type}` | 按角色过滤数据范围 |
| Data Retention | GET/PUT | `/api/v1/data-retention` | super_admin, org_admin |

> 所有管理 API 使用 Session/JWT 认证（非 VK），通过 Console Frontend 登录获取。

### 7.3 错误模型

| HTTP | error.code | 含义 | 响应体 |
|---|---|---|---|
| 401 | `unauthorized` | VK 无效或过期 | `{"error": {"code": "unauthorized", "message": "..."}}` |
| 402 | `budget_exceeded` | 预算硬限制 | `{"error": {"code": "budget_exceeded", "message": "...", "budget_id": "..."}}` |
| 403 | `model_not_allowed` | 无权使用该模型 | `{"error": {"code": "model_not_allowed", "message": "..."}}` |
| 429 | `rate_limited` | 限流触发 | `{"error": {"code": "rate_limited", "message": "...", "retry_after": 60}}` |
| 502 | `provider_error` | Provider 返回错误 | `{"error": {"code": "provider_error", "message": "...", "provider": "..."}}` |
| 503 | `provider_unavailable` | 所有 Provider 不可用 | `{"error": {"code": "provider_unavailable", "message": "..."}}` |

---

## 8. 关键流程时序

### 8.1 请求处理全链路

```text
Client          Gateway         Redis         Provider        ClickHouse
  │               │              │               │               │
  │ POST /v1/     │              │               │               │
  │ chat/comp     │              │               │               │
  │──────────────►│              │               │               │
  │               │ Auth VK      │               │               │
  │               │─────────────►│               │               │
  │               │◄─────────────│               │               │
  │               │              │               │               │
  │               │ Rate Limit   │               │               │
  │               │ (Lua)        │               │               │
  │               │─────────────►│               │               │
  │               │◄─────────────│               │               │
  │               │              │               │               │
  │               │ Budget Check │               │               │
  │               │ (预占)       │               │               │
  │               │─────────────►│               │               │
  │               │◄─────────────│               │               │
  │               │              │               │               │
  │               │ Route Engine │               │               │
  │               │ (内存)       │               │               │
  │               │────┐         │               │               │
  │               │◄───┘         │               │               │
  │               │              │               │               │
  │               │ Proxy (SSE)  │               │               │
  │               │──────────────────────────────►│               │
  │               │              │               │               │
  │ SSE chunk 1   │◄──────────────────────────────│               │
  │◄──────────────│              │               │               │
  │ SSE chunk 2   │◄──────────────────────────────│               │
  │◄──────────────│              │               │               │
  │ [DONE] + usage│◄──────────────────────────────│               │
  │◄──────────────│              │               │               │
  │               │              │               │               │
  │               │ Meter (async)│               │               │
  │               │ Budget settle│               │               │
  │               │─────────────►│               │               │
  │               │              │               │               │
  │               │ Token classify, attribute, waste detect      │
  │               │──────────────────────────────────────────────►│
  │               │              │               │               │
```

### 8.2 预算控制流程

```text
请求到达
    │
    ▼
Budget Waterfall 查找
    │
    ├─ Project budget 余额充足?
    │   ├─ YES → 预占 project budget → 继续
    │   └─ NO  ↓
    │
    ├─ Team budget 余额充足?
    │   ├─ YES → 预占 team budget → 继续
    │   └─ NO  ↓
    │
    ├─ Org budget 余额充足?
    │   ├─ YES → 预占 org budget → 继续
    │   └─ NO  → 402 budget_exceeded
    │
    ▼
预占成功
    │
    ├─ 预占金额 = P90(model, task_type) × price
    │
    ▼
请求执行...
    │
    ▼
请求完成
    │
    ├─ 实际成本 = actual_tokens × price
    ├─ 释放预占: reserved -= estimated
    ├─ 扣减实际: consumed += actual_cost
    ├─ 更新余额: balance -= actual_cost
    │
    ▼
软限制检查
    │
    ├─ consumed/limit ≥ 80% → 告警 (Webhook + 仪表盘)
    ├─ consumed/limit ≥ 100% → 下次请求 402
    └─ 否则 → 正常
```

### 8.3 渠道故障转移

```text
请求路由到 channel_A (priority=1, weight=60)
    │
    ▼
转发到 Provider
    │
    ├─ 成功 → 透传响应 → 更新 channel_A 健康 → 结束
    │
    └─ 失败 (429/5xx)
        │
        ▼
    重试 1: 同模型, 换 channel_B (priority=1, weight=40)
        │
        ├─ 成功 → 透传响应 → 更新 channel_B 健康
        │         → 标记 channel_A 失败 → 结束
        │
        └─ 失败
            │
            ▼
        重试 2: 同模型, 换 channel_C (priority=2, 备选)
            │
            ├─ 成功 → 透传响应 → 结束
            │
            └─ 失败
                │
                ▼
            Fallback: 切到 fallback 模型 (如 gpt-4o)
                │
                ├─ 有 fallback → 回到路由引擎 (新模型)
                │
                └─ 无 fallback → 503 provider_unavailable
                                 → 返回缓存响应 (如配置允许)
                                 → 标记 x-fabric-stale: true
```

### 8.4 VK 申请审批

```text
Developer              Console              Admin API            DB
    │                     │                     │                 │
    │ 填写申请表单         │                     │                 │
    │ (项目名/描述/预算/   │                     │                 │
    │  模型范围/过期时间)  │                     │                 │
    │────────────────────►│                     │                 │
    │                     │ POST /vk-apps       │                 │
    │                     │────────────────────►│                 │
    │                     │                     │ INSERT          │
    │                     │                     │────────────────►│
    │                     │ 201 Created         │                 │
    │                     │◄────────────────────│                 │
    │                     │                     │                 │
    │                     │ 通知 team_admin     │                 │
    │                     │ (仪表盘待审批)       │                 │
    │                     │                     │                 │
    │                     │ ─── team_admin 审批 ───               │
    │                     │                     │                 │
    │                     │ POST /vk-apps/{id}  │                 │
    │                     │   /approve          │                 │
    │                     │────────────────────►│                 │
    │                     │                     │ 生成 VK (fab-xx)│
    │                     │                     │ INSERT project  │
    │                     │                     │ INSERT vk       │
    │                     │                     │────────────────►│
    │                     │ 200 + VK (仅一次)   │                 │
    │                     │◄────────────────────│                 │
    │ 显示 VK (仅一次)    │                     │                 │
    │◄────────────────────│                     │                 │
    │                     │                     │                 │
    │ 后续: VK masked     │                     │                 │
    │ fab-****-abcd       │                     │                 │
```

---

## 9. 部署架构

### 9.1 单一企业部署

```text
┌─────────────────────────────────────────────────────┐
│                企业内网 / 私有云                      │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Gateway  │  │ Gateway  │  │ Gateway  │  (N 副本) │
│  │ #1       │  │ #2       │  │ #3       │           │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘          │
│       │             │             │                 │
│       └─────────────┼─────────────┘                 │
│                     │                               │
│  ┌──────────────────┼──────────────────────────┐   │
│  │            Load Balancer (Nginx)            │   │
│  └──────────────────┬──────────────────────────┘   │
│                     │                               │
│  ┌──────────┐  ┌────▼─────┐  ┌──────────┐         │
│  │ Admin API│  │  Redis   │  │PostgreSQL│         │
│  │ + Meter  │  │ (单节点)  │  │ (主从)   │         │
│  │ + Analytics│ └──────────┘  └──────────┘         │
│  └──────────┘                                       │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │ClickHouse│  │   S3     │  │ Console  │         │
│  │ (单节点)  │  │ (MinIO)  │  │ (Nginx)  │         │
│  └──────────┘  └──────────┘  └──────────┘         │
└─────────────────────────────────────────────────────┘

  最小部署: 1 Gateway + 1 Redis + 1 PostgreSQL + 1 ClickHouse
  生产部署: 3 Gateway + Redis HA + PostgreSQL 主从 + ClickHouse 副本
```

### 9.2 SaaS 部署

```text
┌─────────────────────────────────────────────────────────┐
│                    KodaX Cloud (SaaS)                    │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ Gateway x N │  │ Gateway x N │  │ Gateway x N │     │
│  │ (K8s HPA)   │  │             │  │             │     │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │
│         └────────────────┼────────────────┘             │
│                          │                              │
│  ┌───────────────────────┼──────────────────────────┐   │
│  │              Ingress (TLS termination)           │   │
│  └───────────────────────┬──────────────────────────┘   │
│                          │                              │
│  ┌──────────┐  ┌────────▼─┐  ┌──────────┐  ┌────────┐ │
│  │ Admin API│  │Redis     │  │PostgreSQL│  │ClickHse│ │
│  │ + Meter  │  │Cluster   │  │Cluster   │  │Cluster │ │
│  │ + Billing│  │(3 nodes) │  │(HA)      │  │( shards)│ │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘ │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │   S3     │  │ Console  │  │ Monitor  │             │
│  │ (对象存储)│  │ (CDN)    │  │ (Prom+Grafana)│        │
│  └──────────┘  └──────────┘  └──────────┘             │
└─────────────────────────────────────────────────────────┘

  多租户隔离:
    - 逻辑隔离: tenant_id 字段 + 应用层过滤
    - V2: 支持 Tenant 级加密密钥 (KMS)
    - V2: 支持 Tenant 级数据隔离 (独立 schema 或独立集群)
```

### 9.3 高可用

| 组件 | HA 策略 | 故障切换时间 |
|---|---|---|
| Gateway | 多副本 + Load Balancer 健康检查 | < 5s |
| Redis | Cluster 模式, 自动 failover | < 10s |
| PostgreSQL | 主从复制 + 自动 failover (Patroni) | < 30s |
| ClickHouse | 副本 + 分布式表 | < 60s |
| Admin API | 多副本 | < 5s |

**客户端兜底：** 客户端可配置直连 Provider 作为 Fabric 故障时的 Fallback（通过 SDK 配置）。

---

## 10. 非功能性设计

### 10.1 性能目标

| 指标 | 目标 | 测量方法 |
|---|---|---|
| 网关开销（不含 Provider） | P99 < 50ms | 请求进入 → 转发到 Provider 的时间差 |
| Auth + Rate + Budget + Route | P99 < 15ms | 四步合计 |
| 计量延迟 | 不计入响应延迟 | 异步处理 |
| SSE 透传延迟 | < 5ms per chunk | Provider chunk → 客户端 chunk |
| 实时计量精度 | 与 Provider usage 误差 < 1% | usage 对比 |
| 对账精度 | 与 Provider 月账单差异可追溯 | Adjustment 机制 |
| 故障转移 | Provider 故障 → 自动切换 < 5s | 熔断 → Fallback |

### 10.2 可靠性

| 场景 | 处理 |
|---|---|
| Provider 全部不可用 | 503 + 缓存响应（如配置允许，标记 `x-fabric-stale: true`） |
| Fabric 网关故障 | 多副本 + LB 健康检查；客户端可直连 Provider 兜底 |
| Redis 故障 | 降级为本地限流（宽松策略）+ 告警；预算检查降级为只读 |
| PostgreSQL 故障 | 从库切换；网关使用内存缓存继续运行（配置不变更） |
| ClickHouse 故障 | 计量事件暂存 Redis Streams，恢复后回放 |
| 计量数据丢失 | 基于 Provider 账单补录 |

### 10.3 安全

| 机制 | 实现 |
|---|---|
| Provider Key 加密 | AES-256-GCM 加密存储，密钥由 KMS 管理 |
| VK 认证 | VK 哈希存储（bcrypt），明文仅创建时返回一次 |
| 传输加密 | 所有通信 TLS 1.3 |
| 审计日志 | 所有路由决策、预算变更、Key 操作、配置变更记录审计日志 |
| 多租户隔离 | tenant_id 过滤（V1 逻辑隔离），V2 支持加密隔离 |
| 防御性扫描 | 可选二次扫描，只能升级不能降级数据等级 |
| IP 白名单 | VK 级别可选配置 |
| 速率限制 | 防暴力枚举 VK（连续 401 触发 IP 限流） |

---

## 附录 A：PRD → HLD 映射

| PRD 章节 | HLD 章节 | 设计决策 |
|---|---|---|
| §1 产品定位 | §1 系统架构 | Token Hub + Token ROI 双定位，网关+计量双路径 |
| §2 Token ROI | §4.1 Token 分类器, §4.6 ROI 计算 | 分类权重表 + bandit 算法 |
| §3 Token Hub | §3 网关层设计 | 双端点零转换 + 路由引擎 + 渠道池化 |
| §4 计量计费 | §4 计量层 + §5 定价计费 | 四套账本 + 三层计量 |
| §5 治理 | §6 治理层设计 | RBAC + VK 生命周期 + 数据保存 |
| §6 API 规格 | §7 API 契约 | 网关 API + 管理 API |
| §8 指标监控 | §4.6 ROI 计算 | ClickHouse 聚合 |
| §9 部署可靠性 | §9 部署架构 + §10 非功能性 | 单一企业 / SaaS 两种部署 |
| §10 管理控制台 | §6.1 RBAC + §7.2 管理 API | 4 角色 + 数据范围过滤 |
| §11 设计总结 | §1.1 架构总览 | 核心设计决策落地 |

## 附录 B：技术决策记录

| # | 决策 | 理由 | 替代方案 | 状态 |
|---|---|---|---|---|
| 1 | 网关用 Go | 高并发低延迟，SSE 原生 | Rust (更安全但开发慢), Python (生态好但性能差) | ✅ 已定 |
| 2 | 不做协议转换 | 零 bug、零功能丢失 | 做转换 (更灵活但复杂度高) | ✅ 已定 |
| 3 | Redis 做热状态 | 毫秒级读写，Lua 原子性 | etcd (强一致但慢), 内存 (不可共享) | ✅ 已定 |
| 4 | ClickHouse 做分析 | 列式存储，时序聚合快 | PostgreSQL (事务好但聚合慢), Elasticsearch (全文搜索但重) | ✅ 已定 |
| 5 | 异步计量 | 不阻塞响应 | 同步计量 (简单但增加延迟) | ✅ 已定 |
| 6 | V1 单进程部署 | 降低运维复杂度 | 微服务 (可扩展但复杂) | ✅ V1 单进程, V2 拆分 |
| 7 | 逻辑租户隔离 | V1 快速上线 | 物理隔离 (更安全但成本高) | V1 逻辑, V2 物理可选 |
