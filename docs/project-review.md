# KodaX-Fabric（Token Hub）项目审查报告

| 项 | 内容 |
|---|---|
| 仓库 | `vueadmin/KodaX-Fabric`（GitHub 私有仓库） |
| 原审查提交 | `dev` @ `9f96611`（2026-09-24） |
| 正文对齐 | `dev` @ `869240d`（2026-10-09）；已删除 `9f96611..869240d` 12 个提交之后不再成立的描述 |
| 审查日期 | 2026-10-08（原审查）；过时条目清理 2026-10-09 |
| 审查方式 | 原审查只读。第 6 节命令与结果仍是对 `9f96611` 的实测 |
| 规模 | 25 张表；journal 到 `0060`（61 个 SQL 迁移）；snapshot 仍只有 0000–0023 |
| 方法 | 主审统筹，7 路只读子审查并行（鉴权与租户、Relay 网关、数据库与迁移、管理端与 Token Bot、前端、构建测试部署、文档一致性）。所有高、中风险结论都由主审回到源码逐条复核；关键命令由主审亲自复跑 |

**证据标注说明**

- 【已核实】：主审逐行读过引用的代码路径，或亲自运行命令看到了结果。
- 【推断】：代码层面成立，但实际影响取决于生产数据、部署暴露面或外部系统行为，需要在运行环境中确认。
- 未改动处的 `路径:行号` 仍对应 `9f96611`。

---

## 结论速览

1. **产品形态已经完整**：Token Hub 是一个面向集团内部的大模型"统一接入网关 + 渠道 KEY 资源池调度 + 计量审计"平台，后端 Fastify/Drizzle/PostgreSQL/Redis，前端 Vue 3。核心闭环（建渠道 → 登记席位 → 员工提交 KEY → 签发员工 Key → 转发 → 审计）有 Playwright E2E 覆盖。
2. **最紧迫的是账号安全**：共享初始密码 `Hz123456` 硬编码在代码和前端，批量注册、LDAP 自动开户、钉钉同步建出的账号都不强制改密，知道手机号就能登录他人账号（H1）。
3. **权限模型有企业内提权**：部门管理员的管理范围由"所在部门"推导，被邀请进另一个部门后会自动管那个部门及其子树，进而可以重置员工密码（H2）。
4. **租户生命周期不一致**：停用企业或部门后，员工 API Key 仍能继续调用转发接口、消耗上游额度（H3）。
5. **身份绑定过弱**：注册不验证手机号归属；钉钉"姓名 + 手机号"即可自动入部；LDAP 登录会按"同名"把人映射到已有账号（H4、H5）。
6. **数据保留与个人信息**：员工调用全文无期限落盘、查看与下载不留审计；987 名员工的真实花名册提交在仓库里并打进生产镜像（H6、H7）。
7. **工程质量两极**：服务端源码严格模式零 `any`、类型检查与构建通过、184 个单测全过；但测试代码有 30 个类型错误，10 个集成脚本只有 1 个干净通过，没有 CI 与 lint；迁移 snapshot 从 0024 起断档，`npm run db:generate` 已不可用；生产依赖有 11 个高危公告。

---

## 1. 项目是做什么的

### 1.1 定位

KodaX Fabric 是"企业级 Token 统一接入与效能管理"平台，当前唯一落地模块是 **Token Hub**（`README.md`、`CONTEXT.md`）。它把平台采购的、或员工个人席位对应的上游"渠道 KEY"集中成资源池，主要是智谱 GLM Coding Plan（国内 / 国际），另外支持 DeepSeek 充值线和自建 / 海致自部署的 OpenAI 兼容网关（`server/src/lib/provider-templates.ts:11-13、58、115`）。平台给员工签发统一的 `th_` 前缀 API Key，员工在 Claude Code、Codex、Cursor、WorkBuddy、ZCode 等客户端里把 Base URL 指向本站即可使用；平台负责转发、Key 调度、计量、审计和敏感词合规。生产入口为 `https://tokenhub.haizhi.com`。本环境企业是海致集团；海致科技、海致星图是一级部门。

### 1.2 核心功能（以代码为准）

- **兼容网关（Relay）**：OpenAI Chat Completions、OpenAI Responses、Anthropic Messages（含 `count_tokens`）和模型列表，4 个注册点展开为 15 条路径（`server/src/lib/relay/protocol.ts:14-27`）。支持 SSE 流式透传、失败换 Key 重试、上游 429 解析冷却。
- **渠道 KEY 调度**：按员工近 7 日用量分档。闲置不占 Key；标准档按企业共享，一把 Key 最多 5 人；重度独占（`server/src/lib/relay/binding.ts:211-230`，`server/src/lib/usage-tier.ts:1-77`）。绑定满 2 小时且近 2 小时无调用自动回池（`binding.ts:283-303`）；按 5 小时 / 每周积分窗口做额度避让。
- **编制与权限**：企业 → 部门树（不限层级）→ 员工（可多部门）；四种角色；超管可临时扮演其他角色（Act-as）。
- **渠道、"模式"与席位**：超管维护上游渠道、渠道下的"模式"（即产品线，如套餐 / 充值 / 自建入口）和席位登记；有席位的员工"先测试、测试通过后锁定"提交渠道 KEY。
- **计量与看板**：Token、积分（官方每万 Token 系数，工作日 14:00–18:00 高峰 ×1、其余 ×0.5，`server/src/lib/relay/credit-cost.ts`）、日聚合、工作台、用量分析、用户分析、调度画布。
- **合规与审计**：调用日志（请求全文按内容寻址落盘，可下载）、报错日志、敏感词检测 / 拦截（AC 自动机 + 正则）、操作审计。
- **身份集成**：手机号 + 密码登录、公司 LDAP 登录、钉钉通讯录核对与部门同步。
- **Token Bot**：站内 LLM 助手，工具包括查本人账号、查 Request ID、查邀请人。不能加入部门。

### 1.3 目标用户与角色

| 角色 | 代码值 | 主要职责 |
|---|---|---|
| 超级管理员（平台运营） | `admin` | 维护上游渠道、模式、渠道 KEY、席位；看调度画布、全站调用 / 报错日志、敏感词、操作审计；批量注册用户；编辑企业 / 部门状态。子公司和部门只能通过同步钉钉创建 |
| 企业管理员 | `org_admin` | 管理本企业部门树，指定部门管理员，邀请成员；有席位时可提交渠道 KEY |
| 部门管理员 | `dept_admin` | 管理本部门及子部门：邀请成员 |
| 员工 | `employee` | 加入部门后签发 API Key、配置客户端、查看自己的用量与调用记录 |
| 注册用户 | `employee` 且无企业 / 部门 | 已注册但未入部，不能调用模型 |

### 1.4 主要业务流程

1. **编制**：`POST /api/admin/enterprises` 与 `POST /api/admin/departments` 固定返回 403（`ORG_UNITS_SYNC_ONLY_MESSAGE`）。员工自助申请企业的入口同样 403（`server/src/routes/me.ts`）。每个部门自动配一个隐藏的"默认团队"作为成员挂载点（`server/src/lib/enterprise.ts`）。
2. **人员入部（两条路）**：管理员邀请 `POST /api/admin/teams/:id/members`；注册或登录时按姓名 + 手机号核对钉钉通讯录自动入部（`server/src/routes/auth.ts`、`server/src/lib/dingtalk-register-join.ts`）。Token Bot 不能加入部门。
3. **签发员工 Key**：`POST /api/me/api-keys` 或 `POST /api/me/api-keys/provision`，Key 绑定部门 × 渠道（产品线）× 协议（`server/src/routes/me.ts:83-91`）；加入多个部门时必须选择记账部门。
4. **客户端接入**：员工端"接入教程"（`web/src/views/me/GuideView.vue`）给出各客户端的 Base URL 与配置方法。
5. **一次 Relay 请求**：API Key 鉴权（`server/src/middleware/api-key.ts`）→ 参数校验 → 敏感词检测，命中拦截时伪装成智谱 1301（`server/src/routes/relay/chat-completions.ts:458-495`）→ Redis RPM / 并发租约（`server/src/lib/relay/quota.ts:123-143`）→ 模型解析与路由（`client-model.ts`、`routing.ts`、`model_routes` 表）→ 绑定调度取 Key（`binding.ts:593-665`）→ 上游调用（`upstream.ts`：默认超时 300 秒、最多 5 次尝试，生产配置 3 次；401/403 自动停用 Key，429 按报文冷却）→ 流式在首包确认后才交给客户端，之后不再换 Key → 审计计量（`server/src/lib/relay/audit.ts`：`request_audits`、日聚合、小时积分账本；`requestId` 唯一防重）→ 请求全文按内容寻址落盘（`server/src/lib/relay/request-context.ts`）。
6. **上游运营**：超管建渠道与模式（`POST /api/admin/providers`、`/api/admin/product-lines`）、登记席位（`POST /api/admin/channel-seats`）、批量导入渠道 KEY（`POST /api/admin/credentials/bulk-create`）。有席位的员工先 `POST /api/me/upstream-credentials/test` 拿到测试凭证，再 `POST /api/me/upstream-credentials` 锁定提交。删除渠道会在一个事务内一并销毁席位、渠道 KEY 和绑定该渠道的个人 API Key，历史调用日志保留（`server/src/routes/admin/providers.ts:602-679`）。同一员工同一模式可登记多个席位，第二条起必填标签。
7. **后台任务**（在 API 进程内运行，`server/src/index.ts:13-16`）：闲置 Key 释放每 60 秒（`server/src/lib/idle-binding-release.ts:8`）；分档重算与重绑每天一次且进程启动时立即执行（`server/src/lib/tier-rebind.ts:127-137`）；渠道冷却占比告警每 60 秒。
8. **看板与合规**：超管看全站用量、调度画布、调用 / 报错日志、敏感词记录、操作审计；企业 / 部门管理员看本范围工作台与成员用量；员工看自己的用量与调用记录。

---

## 2. 整体架构

### 2.1 目录职责

| 目录 | 职责 |
|---|---|
| `server/` | `@kodax-fabric/server`：Fastify API 与 Relay 网关。`src/routes`（认证、个人中心、Token Bot、18 个 admin 路由文件、2 个 relay 路由文件），`src/lib`（`relay/` 网关核心、`support-bot/` 智能助手、编制 / 钉钉 / LDAP / 渠道 / 分档 / 告警等领域逻辑），`src/db`（schema、自研迁移器、seed、组织与钉钉同步脚本），`drizzle/`（61 个 SQL 迁移、journal、24 个 snapshot），`test/`（15 个单测文件、10 个集成脚本），`data/`（组织架构 JSON） |
| `web/` | `@kodax-fabric/web`：Vue 3 单页应用，包含超管 / 管理员后台（`views/admin`）和员工端（`views/me`）、调度画布、Token Bot 面板 |
| `e2e/` | Playwright E2E：建库 / 重置脚本、mock 上游、3 个 spec（原审查 2 个 spec 共 5 个用例；其后增加编制层级 spec） |
| `deploy/` | 多阶段 Dockerfile（api 与 web 两个目标）、生产 `compose.yaml`、开发用 `compose.local.yaml`、`Caddyfile`、备份与首个管理员初始化脚本 |
| `scripts/` | `dev.mjs`（先起 API、等 `/health` 就绪再起 Vite）；`envelope-anatomy.mjs`、`simulate-v2-sizing.mjs`、`smoke-v2-roundtrip.mjs` 是请求上下文 v2 格式的离线分析与往返校验工具 |
| `docs/` | PRD、HLD、UI 线框、早期产品稿、FEATURE_LIST、5 篇 ADR（多数已与代码不一致，见第 3.6 节） |

### 2.2 技术栈与关键依赖（版本为本次 `npm ci` 实际安装版本）

| 层 | 依赖 |
|---|---|
| 运行时 | Node（`package.json` 声明 `^20.17.0 \|\| >=22.9.0`，部分依赖实际要求 ≥22.19 / ≥22.22）、npm workspaces |
| API | `fastify@5.11.2`、`@fastify/cors@10.1.0`、`zod@3`、`jose@5.10.0`（HS256 JWT）、`bcryptjs`、`ldapts@9.2.0` |
| 数据 | `drizzle-orm@0.39.3` + `postgres`（postgres.js）+ `drizzle-kit`；PostgreSQL 16；`ioredis` + Redis 7（AOF，512MB，noeviction） |
| 网关 | 原生 `fetch` 与 Web Streams、自研 SSE 解析与透传（`sse.ts`、`native-sse.ts`）、AES-256-GCM 加密渠道 KEY |
| Token Bot | `@earendil-works/pi-agent-core`，上游默认 `glm-5.3-flash` |
| 文件解析 | `exceljs`、`mammoth`、`pdf-parse`（敏感词批量导入） |
| 前端 | `vue@3.5.41`、`vue-router@4.6.4`（history 模式）、`pinia`、`element-plus`（全量注册）、Tailwind 4、`vue-echarts`（按需）、`@vue-flow/*`（调度画布）、`vue-stream-markdown`（Bot 消息渲染）、`axios@1.19.0`、Vite 6、`vue-tsc` |
| 测试 | `node:test`（经 `tsx --test`）、`@playwright/test` |
| 部署 | Docker 多阶段构建、`node:22-bookworm-slim`、`caddy:2-alpine` |

### 2.3 运行时拓扑

```text
员工客户端 / 浏览器
      │ HTTPS（tokenhub.haizhi.com，Caddy 发布在 10.10.0.144:80/443）
      ▼
Caddy：静态 SPA（web/dist）+ 反代 /api /ai /v1 /health /chat/completions /responses /models → api:3000（flush_interval -1 支持 SSE）
      ▼
api（Fastify，单副本，容器启动先跑迁移）
  ├─ PostgreSQL 16（业务、审计、计量）
  ├─ Redis 7（RPM / 并发租约、Token Bot 限流、敏感词配置 pub/sub）
  ├─ request_context 卷（请求全文，内容寻址存储）
  ├─ 后台任务：闲置释放 / 分档重绑 / 容量告警
  └─ 出站：智谱 / DeepSeek / 自建网关、钉钉 OpenAPI、公司 LDAP、Token Bot 的 GLM、告警 Webhook（可选）
```

依据：`deploy/Caddyfile:1-30`、`deploy/compose.yaml:1-137`、`deploy/Dockerfile:1-46`、`server/src/index.ts:9-24`。

### 2.4 数据库与迁移

**表结构（25 张表、13 个枚举）**，定义在 `server/src/db/schema/index.ts`：

| 分组 | 表 | 说明 |
|---|---|---|
| 编制 | `enterprises`、`departments`、`teams`、`team_members`、`employees` | 企业有 `parent_id`、`dingtalk_dept_id`；部门树用 `parent_id`；`teams` 是每个部门一个隐藏的"默认团队"，`team_members` 实际承载"部门成员关系"。员工有钉钉在册标记、职位、入职时间和钉钉档案字段（迁移 0055–0060） |
| 上游 | `providers`、`product_lines`、`upstream_credentials`、`channel_seats`、`model_routes` | `providers` 是厂商（glm / deepseek / custom / haizhi）；`product_lines` 是渠道下的模式，含按协议的 `protocol_configs`、席位数、标签、`relay_pool_key`；`upstream_credentials` 是渠道 KEY（加密存储，状态、优先级、权重、5 小时与每周额度窗口） |
| 调度 | `credential_bindings`、`credential_binding_members`、`credential_usage_hourly` | 绑定范围是多态的 `scope_type + scope_id`（员工 / 企业；`team` 与 `department` 为遗留值）；企业共享的成员表；小时积分账本 |
| 访问 | `employee_api_keys` | `th_` Key 的 SHA-256 哈希 + 可逆密文，绑定产品线、默认团队（即部门）与协议 |
| 计量审计 | `request_audits`、`request_error_logs`、`usage_counters_daily`、`usage_counters_team_daily`、`sensitive_word_hits`、`ops_audit_logs`、`static_files`、`static_file_owners` | 调用审计、失败明细、员工日聚合与部门日聚合、敏感词命中（含请求预览、IP、UA）、操作审计、请求全文内容寻址的登记表 |
| 其他 | `system_settings`、`support_conversations`、`support_messages` | 敏感词配置等 KV 设置；Token Bot 会话与消息 |

**迁移体系**：

- 迁移器是自研的 `server/src/db/migrate.ts`，没有用 drizzle 官方 migrator。它按 `meta/_journal.json` 的顺序执行，每个 SQL 文件一个事务，用 `created_at = journal.when` 判断是否已执行（`migrate.ts:16-52`）。每个文件单独开事务，是为了绕开"同一事务里不能使用刚 `ADD VALUE` 的枚举值"的限制，这个设计是合理的。
- 迁移完成后还会无条件执行几段数据回填，包括从 `request_audits` 全量重算 `usage_counters_daily`（`migrate.ts:59-126`）。
- 文件覆盖：61 个 SQL 文件，journal 61 条（到 `0060`），tag 与文件名一一对应；但 snapshot 只有 0000–0023 共 24 个，0024–0060 缺失。
- 原审查实测（见第 6 节，当时迁移到 0054）：用仓库迁移建出的库与"直接从 schema 生成"的库相比，25 张表、241 列、13 个枚举、83 个索引完全一致；差异只有 3 处：`departments.parent_id` 外键只存在于 SQL、0044 的 3 个函数与触发器只存在于 SQL、0054 的一条列注释。`departments.parent_id` 在 schema 中仍无 `.references()`。

### 2.5 鉴权与权限

- **控制台会话**：手机号 + 密码登录后签发 HS256 JWT，默认 7 天（`server/src/lib/jwt.ts:39-63`），前端存在 localStorage 并以 Bearer 头发送（`web/src/lib/session-storage.ts:1-3、79-81`，`web/src/api/http.ts:9-18`）。`requireSession` 每次请求都回库读取员工状态、角色和企业状态，所以停用账号、调整角色会立即生效（`server/src/middleware/auth.ts:15-109`）。
- **角色与范围（RBAC）**：`requireRoles(...)` 按会话角色放行（`auth.ts:111-117`）。企业管理员的范围是本企业；部门管理员的范围是"本人所在的全部部门及其子树"（`server/src/lib/org.ts:25-37、98-104`）；员工只能访问自己的资源（`/api/me/*` 的 `:id` 查询都带 `employeeId = 本人`）。超管专属接口包括企业、上游、渠道 KEY、席位、调度画布、日志、敏感词、设置、用户分析。
- **企业 / 租户隔离**：企业管理员的用户列表、部门、团队、工作台都按 `session.enterpriseId` 过滤（`server/src/lib/enterprise.ts:55-90`）。未发现企业管理员跨企业读写的路径；主要问题出在部门管理员范围（H2）、停用状态没有传导到 relay（H3），以及管理员能看调用明细与产品口径不一致（M4）。
- **Act-as**：只有数据库中真实角色为 `admin` 的会话才解析 `X-Act-As` 请求头；目标企业、部门、员工都会回库校验，不能扮演成 `admin`（`auth.ts:86-108`）。扮演后 `requireRoles("admin")` 按扮演后的角色判断，所以扮演期间进不了超管接口；`requireTrueAdmin` 只用于读取组织树（`server/src/routes/admin/act-as.ts:10`）。
- **API Key**：`th_` + 24 字节随机数的 base64url（`server/src/lib/api-key.ts:8-15`）；鉴权时按 SHA-256 哈希查库，不经缓存，吊销立即生效；校验 Key 状态、过期、员工状态与角色、默认团队成员关系和团队状态（`server/src/middleware/api-key.ts:99-192`）。
- **LDAP**：依次用 `cn=` 与 `uid=` 两种 DN 模板做 bind；用户名有白名单，空密码直接拒绝（`server/src/lib/ldap-auth.ts:21-29、71-99`）。认证通过后先按手机号、再按唯一同名映射到系统内账号，仍对不上时通过钉钉开户（`server/src/routes/auth.ts:264-323`）。
- **钉钉**：企业内部应用的 AppKey / AppSecret；注册时按手机号或姓名核对通讯录并自动入部（`server/src/lib/dingtalk-register-join.ts`）；另有部门 ID 同步、用户批量建号、组织架构同步脚本（`server/src/db/sync-*.ts`）。

### 2.6 核心领域模型：网关、渠道、模式、协议

| 概念 | 代码落点 | 说明 |
|---|---|---|
| 网关 | `server/src/routes/relay/*`、`server/src/lib/relay/*` | Token Hub 本身就是兼容网关；"自建网关"指厂商代码为 `custom` 的上游，地址由超管填写 |
| 渠道 | 新版 UI 中是 `providers`（厂商级）；CONTEXT.md 中描述的字段（名称、标签、供应商、协议、状态、席位数）实际属于 `product_lines` | **术语漂移**：最新提交的界面把"渠道"定为厂商、"模式"定为产品线（`web/src/views/admin/TempChannelsView.vue:964` 注释"一次调用建出渠道（provider）+ 第一个模式（product line）"），与 CONTEXT.md 的"渠道"含义不同 |
| 模式 | `product_lines` | 例如 GLM Coding Plan 套餐、充值 API、某个自建入口。`product_type` 取值为 `api` 或 `coding_plan`；按协议配置 baseUrl 与鉴权方式；智谱各套餐通过 `relay_pool_key = glm:coding_plan` 共享一个调度池（由 0044 的触发器填充） |
| 协议 | `relay_protocol` 枚举 | `openai_chat`、`anthropic_messages`、`openai_responses` |
| 渠道 KEY | `upstream_credentials` | 状态有 active / disabled / auto_disabled / cooling；带优先级、权重、5 小时与每周积分上限及窗口锚点 |
| 席位 | `channel_seats` | 员工 × 产品线 × 标签；同一员工同一模式可有多条，第二条起必填标签 |
| 绑定 | `credential_bindings`、`credential_binding_members` | 重度员工独占，标准档按企业共享（每把 Key 最多 5 人） |
| 分档 | `employees.usage_tier` | 新账号 7×24 小时保护期内固定为重度；之后按近 7 日日均 Token 分为闲置、标准（<3000 万）、重度（≥3000 万） |

### 2.7 主要 API 路由

服务端共 101 个路由注册点（`app.get/post/patch/delete`，主审 `rg` 统计），其中 relay 的 4 个注册点展开为 15 条路径。

| 分组 | 前缀 / 路径 | 注册数 | 允许角色 |
|---|---|---|---|
| 健康检查 | `GET /health` | 1 | 匿名 |
| 认证 | `/api/auth/register`、`login`、`login-ldap`、`me`、`change-password` | 5 | 前三个匿名，后两个需登录 |
| 个人中心 | `/api/me/*`（编制、可用渠道、渠道 KEY 测试与提交、模型、API Key、用量、分析、调用记录） | 19 | 四种角色（超管不能签发 Key） |
| Token Bot | `/api/support/status`、`history`、`chat` | 3 | 四种角色 |
| 编制与用户 | `/api/admin/enterprises`(5)、`departments`(4)、`teams`(4)、`users`(9)、`act-as/org`(1) | 23 | 企业接口仅超管；部门、团队、用户接口三类管理员；act-as 仅真实超管 |
| 看板分析 | `/api/admin/overview`(2)、`user-analytics`(1) | 3 | overview 三类管理员（其中 analytics 仅超管）；user-analytics 仅超管 |
| 上游与调度 | `providers` / `product-lines`(7)、`channel-seats`(4)、`credentials` 等(9)、`key-bindings`(3)、`model-prices`(1)、`model-routes`(4) | 28 | 仅超管 |
| 日志与合规 | `logs`(4)、`error-logs`(2)、`ops-audit`(1)、`sensitive-words` 与命中记录(6)、`settings`(2) | 15 | 仅超管 |
| Relay | `/v1/chat/completions`、`/v1/responses`、`/v1/messages`、`/v1/messages/count_tokens`、`/v1/models`，以及 `/ai/*` 与无前缀的兼容路径 | 4（15 条路径） | 员工 API Key |

### 2.8 前后端交互

- 前端 axios 实例的 `baseURL` 为空，走同源；请求拦截器注入 `Authorization: Bearer` 和 `X-Act-As`（JSON）；响应拦截器遇到 401 清会话并跳转登录页，遇到 `INVALID_ACT_AS` 退出扮演，没有统一处理 403（`web/src/api/http.ts:1-42`）。
- 统一响应结构为 `{ success, data | message }`；relay 接口则按 OpenAI / Anthropic 各自的错误格式返回。
- 开发时 Vite 把 `/api`、`/health`、`/ai`、`/v1`、`/chat/completions`、`/responses`、`/models` 代理到 `DEV_API_TARGET`，默认 `http://127.0.0.1:3000`（`web/vite.config.ts:6-43`）；生产由 Caddy 按相同路径反代（`deploy/Caddyfile:20-23`）。
- Token Bot 是一次 `POST /api/support/chat` 返回完整 JSON，不是浏览器端流式；服务端内部用 agent 工具循环。
- 路由全部懒加载；前端角色守卫读取 localStorage 中的用户信息，真实权限以后端为准（`web/src/router/index.ts:236-261`）。

### 2.9 本地运行与部署

- **本地开发**：在仓库根目录准备 `.env`（`DATABASE_URL`、`REDIS_URL`、`JWT_SECRET` 与 `CREDENTIAL_ENCRYPT_KEY` 至少 16 位等，全部在 `server/src/config.ts:40-123` 用 zod 校验）→ `npm install` → `npm run db:setup`（迁移 + seed）→ `npm run dev`（`scripts/dev.mjs` 先起 `tsx watch` 的 API，45 秒内 `/health` 就绪后再起 Vite 5173 端口）。`deploy/compose.local.yaml` 可起本地 Postgres 与 Redis。
- **生产部署**：离线导入镜像（`pull_policy: never`）→ 先起 postgres 和 redis → 用 `deploy/bootstrap-admin.sh` 一次性创建首个超管（要求显式传入手机号和密码）→ `docker compose up -d`。api 容器每次启动先执行 `migrate.js` 再启动服务（`deploy/Dockerfile:41`），以 `node` 用户运行并带健康检查；web 镜像是 Caddy + 静态文件，使用宿主机 `/etc/tokenhub/tls` 下的证书。
- **备份**：`deploy/backup.sh` 生成本机 `pg_dump | gzip`，保留 14 天。

### 2.10 测试体系现状

| 层次 | 内容 | 本次结果 |
|---|---|---|
| 单元 / 组件测试 | `npm test` 运行 15 个 `*.test.ts`（node:test + Fastify inject + mock），不依赖真实数据库 | 184 通过 / 0 失败（主审复跑） |
| 集成脚本 | 10 个 `test:*` 脚本，需要真实 Postgres / Redis，不在 `npm test` 中 | 1 个通过、2 个断言通过但进程不退出、2 个清理阶段失败、4 个期望过时失败、1 个跳过 |
| E2E | Playwright；原审查 2 个 spec 共 5 个用例，5/5 通过，耗时 13.2 秒。其后增加 `enterprise-hierarchy.spec.ts` | 见第 6 节 |
| 静态检查 | 服务端源码与前端类型检查通过；测试代码 30 个类型错误；没有 ESLint / Prettier 配置；没有 CI（无 `.github/workflows`） | 见第 6 节 |

---

## 3. 代码质量

### 3.1 结构清晰度

- **优点**：服务端分层清晰。路由只做参数解析与编排，领域规则多写成纯函数（如 `planChannelSeatCreate`、`resolveBindingScope`、`classifyUsageTier`），并有对应单测。Relay 核心按职责拆分为鉴权、路由、绑定、上游、SSE、审计、上下文、敏感词、配额等模块。注释质量高，很多地方写明了设计约束（例如迁移器为什么每个文件单独开事务）。
- **问题**：存在多个超大文件，路由、领域规划和 SQL 混在一起：`server/src/routes/admin/credentials.ts`（2147 行）、`server/src/routes/me.ts`（1603 行）、`server/src/lib/relay/binding.ts`（1411 行）、`server/src/routes/relay/anthropic-messages.ts`（1085 行）与 `chat-completions.ts`（1042 行）、`server/src/routes/admin/users.ts`（1050 行）。前端有 5 个超过 1000 行的单文件组件（`EnterprisesView.vue` 1664 行、`TempChannelsView.vue` 1661 行、`CredentialsView.vue` 1643 行、`KeyBindingsView.vue` 1531 行、`DashboardView.vue` 1076 行）。

### 3.2 重复与遗留代码

- **Relay 两条主路由高度同构**：`chat-completions.ts` 与 `anthropic-messages.ts` 的重试循环、首包确认、交接、审计收尾几乎相同，`sse.ts` 与 `native-sse.ts` 的透传也基本同构。协议差异埋在副本里，已经出现行为分叉（例如错误透传口径不同，见 M11）。【已核实】
- **"团队"概念的遗留**：产品层已取消团队，但实现仍以 `teams` / `team_members` 承载部门成员关系；邀请接口仍叫 `/api/admin/teams/:id/members`（`server/src/app.ts:10、47`）；`binding_scope_type` 枚举仍有 `team` 与 `department`（`server/src/db/schema/index.ts:50-55`）；`employees.dept` 自由文本与部门树并存；用户可见文案仍提示"等待团队管理员邀请"（`server/src/routes/me.ts:234、241`）。【已核实】
- **死代码与死配置**：`error-logs.ts:109-125` 中按企业 / 部门收窄的分支不可达，因为该文件的钩子只放行超管（`error-logs.ts:137`）；`key-bindings.ts:292` 的企业管理员分支不可达（钩子在 `key-bindings.ts:49`）；compose 中的 `AUDIT_BODY_KEEP_LAST`、`AUDIT_BODY_PRUNE_INTERVAL_MS`（`deploy/compose.yaml:76-77`）在代码里已无对应项；`server/src/db/cleanup-demo-data.ts:14` 删除的表在 0017 迁移中已被删除。【已核实】
- **未使用依赖**：前端 `marked`、`sanitize-html`（`web/package.json:23、25`）在源码中没有任何引用；根目录 `pptxgenjs`（`package.json:29-31`）没有任何引用，却带来了 `image-size` 的高危公告。【已核实】
- **误提交的文件**：`web/.vite/deps/_metadata.json`、`web/.vite/deps/package.json`（Vite 预构建缓存）、`.zcode/plans/*.md`（会话草稿）都在版本库中，`.gitignore` 没有排除。【已核实】

### 3.3 类型安全

- 服务端 `strict: true`，`server/src` 中没有 `any`，只有 1 处 `as unknown as`（`chat-completions.ts:146`，Web 流转 Node 流）。各路由普遍用 zod 校验 body、query、params。【已核实】
- 前端有 19 处 `: any`，大多是 `catch (e: any)`，另有 `KeyBindingsView.vue:316-317` 的 `nodes: any[]`、`edges: any[]`；`tsconfig` 关闭了 `noUnusedLocals` 与 `noUnusedParameters`。这也违反团队"禁止 any"的约定。【已核实】
- 测试代码不在 `server/tsconfig.json` 的 `include` 里；纳入后有 30 个类型错误，测试已跟不上 schema 变化（例如仍使用 `teamRole`、`team_admin`、`retryCount`）。【已核实】

### 3.4 错误处理

- 管理接口错误结构统一为 `{ success: false, message }`，大部分写操作有操作审计。
- 依赖故障策略不一致：relay 的 RPM / 并发在 Redis 故障时直接 500（fail-closed，`server/src/lib/relay/quota.ts:44-52`，路由只特殊处理 `RelayLimitError`：`chat-completions.ts:498-501`）；Token Bot 限流在 Redis 故障时放行（fail-open，`server/src/lib/support-bot/rate-limit.ts:20-28`）；敏感词配置读取失败时沿用最后一次已知词表。三种做法各有道理，但没有成文的统一策略。【已核实】
- 多步写操作缺事务：删除部门及其默认团队的整个流程没有事务（M10）；企业共享绑定的"插入绑定 → 加入成员"也不是原子操作（M6）。【已核实】
- 前端 403 在 4 个页面被静默吞掉，页面空白且没有提示（`DashboardView.vue:655`、`AdminUsageAnalysisView.vue:445`、`AdminUsageDashboard.vue:595`、`UserAnalyticsView.vue:559`）。【已核实】

### 3.5 测试覆盖缺口

- E2E 覆盖登录冒烟、KEYS 看板、一条使用自建渠道 + OpenAI Chat 的闭环，以及编制层级（子公司/部门只能钉钉同步创建）。
- 以下关键路径没有任何 E2E：越权与租户隔离、停用企业或部门、钉钉 / LDAP 入部、敏感词拦截、Anthropic 与 Responses 协议、流式中断、闲置释放与分档重绑、删除渠道或部门。
- 10 个集成脚本大多已经失修，也没有在任何流水线中运行。

### 3.6 文档与代码一致性

- `README.md:34-41` 写 `docs/` 只保留四篇文档，实际还有 `FEATURE_LIST.md`、`features/`、`adr/`。
- ADR 0001 / 0003 仍以"团队"为记账和渠道 Key 的单位，ADR 0004 写"标准档渠道 Key 跟部门走"（`docs/adr/0004-multi-department-membership.md:3`），而代码是按企业共享（`binding.ts:221-230`）。
- `docs/FEATURE_LIST.md:17、28` 与 `CHANGELOG.md:83` 写企业管理员可以打开调度画布，代码中调度画布只对超管开放（`key-bindings.ts:49`）。
- `deploy/README.md:11-14、63` 引用的 `docs/runbook-release.md`、`docs/pilot-charter.md` 已不存在，恢复演练步骤缺失。
- API Key 是否绑定协议有三种说法：CONTEXT.md 写 Key 绑定"部门 × 渠道 × 协议"（`CONTEXT.md:67-69`），签发时也会存协议（`me.ts:83-91`）；但 relay 鉴权把 `principal.protocol` 设为路由的协议（`api-key.ts:182-191`），存下的协议并不参与校验；接入教程则写"Key 不绑定协议"（`GuideView.vue:400`），与运行时行为一致。

以上各条均【已核实】。

---

## 4. 风险与问题

严重度说明：**高**指可被直接利用造成账号接管、越权、租户隔离失效或重大合规风险；**中**指需要特定条件，或影响正确性、性能、可运维性；**低**指影响有限或属于卫生问题。

### 4.1 高

#### H1 共享初始密码 `Hz123456` 硬编码且多处外泄，导入与开户账号不强制改密，知道手机号即可登录他人账号

状态：【已核实】（代码路径）；受影响账号数量【推断】，需在生产库确认。

- 常量定义在 `server/src/lib/password.ts:7`。
- 以下入口都用这个密码建号或重置，且全部 `mustChangePassword: false`：超管批量注册（`server/src/routes/admin/users.ts:719-733`，响应还回传 `initialPassword`：`users.ts:714、770`）；审核通过（`users.ts:609-617`）；LDAP 首次登录自动开户（`server/src/lib/ldap-dingtalk-provision.ts:128-141`）；钉钉通讯录批量建号脚本（`server/src/db/sync-dingtalk-users.ts:50-63`）。
- 外泄途径：前端文案（`web/src/views/admin/EnterprisesView.vue`）打包进可公开下载的静态 JS；以及仓库本身。
- 强制改密机制已失效：登录时无条件签发 `mustChangePassword: false`（`server/src/routes/auth.ts:96-103、117-119`）；服务端没有拦截，前端路由守卫也不检查（`web/src/router/index.ts:236-261`）；迁移 `0046` 还把存量的 `must_change_password = true` 全部改成了 false（`server/drizzle/0046_optional_password_change.sql:3`）。
- 最危险的是 LDAP 与钉钉开户的账号：这些用户平时走 LDAP 登录，不会去改本地密码，因此"手机号 + Hz123456"在 `POST /api/auth/login`（`auth.ts:220-262`）上长期有效。登录后，`GET /api/me/api-keys` 会返回该账号全部明文 Key（`server/src/routes/me.ts:792-833`），Key 不随改密失效，攻击者可以长期使用。

#### H2 部门管理员范围由所在部门推导，被邀请进另一部门即扩大管理范围（企业内提权）

状态：【已核实】（静态代码路径完整）。

- 部门管理员的管理范围不是"被任命管理的部门"，而是"本人所在的全部部门及其子树"：非扮演场景下，`scopedDepartmentIds` 回落到 `listAdminDepartmentIds(employeeId)`（`server/src/lib/org.ts:98-104`），后者直接取该员工所有 `team_members` 所在部门再展开子树（`org.ts:25-37`）。迁移 0051 删掉 `team_members.role` 之后，成员关系里已经没有"是否为管理员"这一信息。
- 企业管理员把某位部门管理员以普通成员身份邀请进另一个部门时，他会自动成为该部门及其子树的管理员。之后用户列表、成员用量与调用明细、修改用户、重置密码（`canManageScopedUser`）以及部门成员管理都会覆盖新范围。重置密码时管理员可以直接指定新密码且不强制改密（`users.ts`），因此可以登录该部门任意员工的账号并拿到其明文 Key。

#### H3 停用企业或停用部门后，员工 API Key 仍可继续调用 Relay

状态：【已核实】。

- Relay 鉴权只关联 `employee_api_keys` 与 `employees`，校验 Key 状态、过期时间、员工状态与角色，以及默认团队的成员关系和 `teams.status`（`server/src/middleware/api-key.ts:116-180`）；不读取 `enterprises.status`，也不读取 `departments.status`。
- 停用企业只更新 `enterprises.status`，不吊销 Key（`server/src/routes/admin/enterprises.ts:170-214`）；停用部门只更新 `departments.status`（`server/src/routes/admin/departments.ts:200-239`），全仓库没有任何同步默认团队状态的 `update(teams)` 语句。
- 对比：控制台会话会拦截停用企业的员工（`server/src/middleware/auth.ts:60-73`），两条链路口径不一致。
- 影响：被停用的企业或部门仍在消耗平台渠道 KEY 与上游额度，并继续产生用量记账，"停用"不能用作应急止损手段。

#### H4 开放注册不验证手机号归属；钉钉"姓名 + 手机号"即可自动入部

状态：【已核实】（代码）；暴露面【推断】。

- `POST /api/auth/register` 匿名可用，直接创建 `status: "active"` 的账号，没有短信或钉钉免登校验（`server/src/routes/auth.ts:125-156`）。手机号已存在时返回 409"该手机号已提交申请或已注册"（`auth.ts:212-215`），可用于枚举手机号。
- 注册后立即按用户填写的姓名和手机号查询钉钉通讯录，匹配上就写入企业并加入对应部门（`auth.ts` → `server/src/lib/dingtalk-register-join.ts`）。知道同事姓名和手机号的人可以抢先注册，进入同事的真实部门。同事本人之后注册会被 409 拒绝；如果同事走 LDAP 登录，还会因为手机号匹配登进这个被抢注的账号（`server/src/lib/ldap-auth.ts:60-63`），双方共用同一个账号。对不上钉钉时账号仍注册成功，须由部门管理员邀请。
- 暴露面：生产 compose 把 Web 绑定在内网地址 `10.10.0.144`（`deploy/compose.yaml:118-120`），推断只有内网或 VPN 可达；但 `deploy/README.md:14` 提到"Public pilot policy"，需要确认外网是否可达。

#### H5 LDAP 登录按"姓名"把公司账号映射到系统内已有账号，存在错绑与接管

状态：【已核实】（代码）；需要同名才能触发【推断】。

- LDAP 认证通过后，先按 LDAP 上的手机号找员工。如果找不到（包括 LDAP 有手机号但与系统不一致的情况），就按显示名在**全库**找唯一同名者并直接登录（`server/src/lib/ldap-auth.ts:56-69`）。为此 `server/src/routes/auth.ts:288-289` 会把整张 `employees` 表连同密码哈希读进内存。
- 仍然找不到时，用 LDAP 显示名去钉钉通讯录精确搜索；命中唯一同名者后取其手机号，如果系统里已有这个手机号的账号，就直接返回该账号完成登录（`server/src/lib/ldap-dingtalk-provision.ts:56-80、125-126`）。
- 结果：LDAP 用户 A 如果与系统中另一位员工 B 同名（例如 B 属于另一家企业，或 A 还没注册），A 会直接登录进 B 的账号。中文重名并不少见，而且整个过程没有提示或二次确认。
- 正面情况：用户名有白名单（`ldap-auth.ts:21-23`），空密码直接拒绝（`ldap-auth.ts:77`），不存在 LDAP 注入或匿名 bind 绕过。

#### H6 员工调用全文（prompt、附件、响应）无期限落盘，查看与下载不留审计，没有加密和清理

状态：【已核实】（代码）；容量数据取自 CHANGELOG【推断】。

- `server/src/lib/relay/request-context.ts:1-14` 文件头明确写着 "Retention is unlimited by design"。内容寻址存储会把 system、tools、长文本以及图片和 PDF 的原始二进制长期保存在 `request_context` 卷（`deploy/compose.yaml:78、88-89`），全仓库没有任何清理任务。
- 超管查看调用详情和下载全文（`server/src/routes/admin/logs.ts:256-340、342-383`）都不写 `ops_audit_logs`；详情接口还返回员工手机号（`logs.ts:270`）。
- 其他无期限保存的个人数据：敏感词命中的请求预览、摘要、IP 和 UA（`server/src/db/schema/index.ts:515-545`）；Token Bot 的全部对话（`schema/index.ts:570-595`），`/api/support/history` 会一次返回最新会话的全部消息（`server/src/routes/support.ts:52-60`）。
- 容量：CHANGELOG 按 11,364 次请求的样本测算，去重后日增约 2.5–3 GB，全年文件对象在千万级（`CHANGELOG.md:15`）。备份脚本只备份 Postgres（`deploy/backup.sh:21-23`），这些文件不在备份范围内，也没有容量告警。
- 风险：员工的代码、客户数据和个人信息会被永久保存，并可被超管无痕下载，不符合个人信息处理的最小必要和保存期限原则。

#### H7 真实组织花名册与员工信息提交进仓库，并打进生产镜像

状态：【已核实】。

- `server/data/haizhi-org.json` 包含 206 个部门、1,169 条成员记录（去重后 987 人），成员字段为姓名、钉钉 userId、职务和工号（本报告没有抄录任何具体值）。该文件由提交 `f940752`（2026-09-12）加入；`server/src/db/sync-org-chart.ts:17` 默认读取它；`deploy/Dockerfile:29` 把 `server/data` 复制进 api 镜像。
- 源码里硬编码了某位员工的 ID 和姓名（`server/src/lib/usage-tier.ts:17-19`）；`SEED_ADMIN_PHONE` 的默认值是一个格式真实的手机号（`server/src/config.ts:91`）。
- 仓库是个人 GitHub 账号下的私有仓库（`gh repo view` 显示 PRIVATE，owner 为 `vueadmin`）。这些数据已经进入 git 历史，只删除文件无法清除。

### 4.2 中

#### M1 会话失效机制不足：改密后旧 token 最长 7 天有效，会话存在 localStorage【已核实】

- JWT 使用 HS256，默认 7 天有效（`server/src/lib/jwt.ts:39-63`），载荷里含手机号和姓名（`jwt.ts:52-58`）。token 没有 jti 或版本号；`requireSession` 只按 `sub` 回库检查状态和角色（`server/src/middleware/auth.ts:36-58`），不比较签发时间与 `password_changed_at`。改密或管理员重置密码后，旧 token 最长 7 天仍然有效。停用账号会立即失效，这一点是正确的。
- token、用户信息和扮演信息都存在 localStorage（`web/src/lib/session-storage.ts:1-3、79-81`），一旦出现 XSS 会话就会被拿走。目前前端没有 `v-html` 一类的 XSS 汇点（见附录），所以这是潜在风险。
- 管理员（包括部门管理员）重置密码时由管理员指定新密码，并设置 `mustChangePassword: false`、`passwordChangedAt: null`（`server/src/routes/admin/users.ts:1022-1030`），管理员事后仍知道员工的密码。

#### M2 登录与注册没有限流或锁定，注册接口可枚举手机号【已核实】

- 登录、LDAP 登录和注册都没有限流或失败锁定（`server/src/routes/auth.ts:125-323`）。全项目只有 Token Bot 和 relay 用 Redis 做了限流。
- 注册接口的 409 可以用来判断手机号是否已注册（`auth.ts:212-215`）。登录对"账号不存在 / 密码错误 / 已停用"返回统一文案，这一点做得对；`pending` 状态的 403 只在密码正确后才返回（`auth.ts:247-253`），不构成枚举。

#### M3 员工 API Key 可逆加密，列表接口返回明文，查看不留审计【已核实】

- 员工 Key 除了 SHA-256 哈希，还用 AES-256-GCM 做了可逆加密（`server/src/lib/api-key.ts:17-32`）。`GET /api/me/api-keys` 每次都把全部 Key 解密成明文返回（`server/src/routes/me.ts:121-128、792-833`）；前端默认打码，点"显示"时直接用列表里的明文（`web/src/views/me/KeysView.vue:253-256、360-364`）。查看和复制都不留审计。
- 结合 H1、H4、H5 以及 localStorage 会话，账号一旦失守，所有 Key 都会被整体拿走，而且改密不影响 Key。
- 加密实现本身没有问题：每次随机生成 12 字节 IV、校验 GCM tag、按用途派生子密钥（`server/src/lib/crypto-secret.ts:10-37`）。

#### M4 企业与部门管理员能查看员工逐条调用记录和最近报错，与产品口径不一致【已核实】

- CONTEXT.md 规定企业管理员和部门管理员"不能看调度画布、调用日志或报错日志"（`CONTEXT.md:18、22`）。专用页面的接口确实只对超管开放（`logs.ts:124-126`、`error-logs.ts:137`、`key-bindings.ts:49`），但还有两个口子：
  - `GET /api/admin/users/:id/logs` 对企业管理员和部门管理员开放（`server/src/routes/admin/users.ts:280、514-581`），可以按最长 366 天的范围翻看所辖员工的逐条调用（requestId、模型、供应商、token、状态、时间）。
  - 工作台 `GET /api/admin/overview` 会向这两类管理员返回 `recentErrors`（`server/src/routes/admin/overview.ts:821、840、876、894`），企业侧的这条查询没有日期条件（`overview.ts:644-666`）。
- 泄露的是调用元数据而不是内容，但与产品口径不一致，需要二选一：改文档，或者收紧接口。

#### M5 Act-as 扮演不写审计【已核实】

- `requireSession` 解析 `X-Act-As` 后直接改写会话的角色和范围（`server/src/middleware/auth.ts:86-108`），没有写审计。扮演期间发生的写操作，审计中记录的是超管本人的 ID，无法区分当时是否在扮演。扮演员工时还可以替他签发 Key、提交渠道 KEY（`me.ts` 中统一使用 `actingEmployeeId`）。

#### M6 企业共享绑定：一次不可用判定会删除整条绑定，且建绑定与加成员不是原子操作【已核实】（代码）；实际抖动程度【推断】

- 在 `acquireEnterpriseShare` 中，只要当前员工所在共享 Key 对**本次请求**不可用，就删除整条 `credential_bindings`（`server/src/lib/relay/binding.ts:688-689、738-740`）。不可用的原因包括：额度已满、冷却或停用、被本次请求前一次失败排除、Key 不支持本次请求的协议（`binding.ts:944-984`）。成员表对绑定是级联删除（`server/src/db/schema/index.ts:348-350`），所以同一把 Key 上另外最多 4 名员工也会一起被解绑，下次请求时重新挂 Key。额度耗尽时这样做尚可接受；但因为一次偶发失败或某一名成员使用的协议不同，就让所有人重新绑定，会造成不必要的抖动。
- 新建共享绑定时，先插入一条没有成员的绑定（`binding.ts:1070-1079`），再调用 `tryAddMember` 加入成员（`binding.ts:744-755`）。与此同时，热路径（`binding.ts:661-663`）或每日任务中的 `releaseOrphanBindings` 会把"没有成员的企业绑定"当作孤儿删除（`binding.ts:265-267、830-880`）。`tryAddMember` 的 `FOR UPDATE` 不检查行是否还存在（`binding.ts:1255`），随后插入成员会触发外键错误，请求返回 500。触发窗口很窄，属于低概率竞态。

#### M7 Relay 热路径的性能隐患【已核实】（代码）；SQL 条数为估算【推断】

- 每次请求的 `resolveEmployeeBinding` 都会全表读取 `departments` 来计算一级部门（`server/src/lib/relay/binding.ts:468-476、480-485`），但这个结果在当前分档规则中并不参与计算（`binding.ts:221-230` 只使用分档、员工和企业）。
- 员工分档发生变化的请求（例如闲置员工当天第一次调用被提升为标准档，`binding.ts:609-627`）会在热路径中调用 `releaseOrphanBindings`，全量读取所有绑定、所有在职员工、所有成员关系和部门（`binding.ts:661-663、830-900`）。早高峰大量员工同时"复活"时，这会放大成多次全表扫描。
- 企业共享分片按 `(relay_pool_key, scope_type, scope_id)` 查询，但唯一索引排除了 enterprise（`server/src/db/schema/index.ts:337-341`），这条查询没有可用索引。
- 粗略估算，一次已绑定的请求约执行 15–25 条 SQL，未实测。

#### M8 对"单实例还是多实例"的假设不一致【已核实】（代码）；扩容后才会暴露【推断】

- 三个后台任务在每个 API 进程启动时无条件运行（`server/src/index.ts:13-16`），没有选主或分布式锁。`tier-rebind` 在进程启动时立即全量重算分档并重绑（`server/src/lib/tier-rebind.ts:127-137`），滚动发布或扩容时多个实例会同时改写绑定表。
- 调度依赖进程内的在途计数（`server/src/lib/relay/credential-load.ts:1-10、61-66`，注释写明 "assume a single relay instance"），容量告警的静默时间也只存在内存里（`server/src/lib/capacity-alert.ts:149`）。与此同时，敏感词配置已经用 Redis pub/sub 做多实例同步（`CHANGELOG.md:35`），两类假设互相矛盾。
- api 容器每次启动都会先跑迁移（`deploy/Dockerfile:41`），而迁移器没有加锁（见 M9）。
- 当前 compose 只有一个 api 副本，以上问题在扩容时才会出现。

#### M9 迁移体系脆弱【已核实】（含实测）

- snapshot 断档：`server/drizzle/meta` 只有 0000–0023 共 24 个 snapshot，journal 却有 61 条（到 `0060`）。`npm run db:generate` 会用 0023 时的状态与当前 schema 做 diff；原审查实测会进入交互式的"是否重命名"确认，无法非交互运行；即使硬跑，也会生成重复建表、删表的错误迁移。
- 迁移器（`server/src/db/migrate.ts:16-52`）没有 `pg_advisory_lock`；`drizzle.__drizzle_migrations` 没有唯一约束；记录的 hash 从不校验，已经上线的 SQL 被改动也不会被发现。
- 每次迁移都会从 `request_audits` 全量重算 `usage_counters_daily` 并覆盖写入（`migrate.ts:106-126`）。审计表越大，每次发版越慢；如果与线上写入并发，`DO UPDATE SET ... = excluded` 会覆盖并发期间的累加【推断】。
- schema 与 SQL 漂移（实测）：`departments.parent_id` 的自引用外键只在 SQL 中（`server/drizzle/0037_nested_departments.sql:2`），schema 没有声明（`server/src/db/schema/index.ts:109`）；0044 的 3 个函数和触发器只在 SQL 中（`server/drizzle/0044_glm_coding_plan_pool.sql:58-123`），基于 schema 建出的库不会自动填充 `relay_pool_key`。
- 迁移 0046 清空了所有强制改密标记（见 H1）。journal 中 0048 的 `when` 大于 0049（`server/drizzle/meta/_journal.json:342-353`），按时间排序的工具会把它们的顺序弄反。
- 早期的 `DROP TABLE` 不带 `IF EXISTS`，也没有回滚文件；仓库里没有 `CREATE INDEX CONCURRENTLY`，而它与"每个文件一个事务"的执行方式冲突，将来给大表加索引会锁表。

#### M10 删除部门不在事务中、不检查子部门，并会抹掉部门的用量历史【已核实】（代码）；失败场景【推断】

- 删除部门时只检查"默认团队之外的团队"和直接成员（`server/src/routes/admin/departments.ts:278-294`），不检查子部门。随后对每个团队执行 `detachAndDeleteTeam`：删除 `usage_counters_team_daily`；把 `request_audits`、`request_error_logs`、`sensitive_word_hits`、`employee_api_keys` 上的 `team_id` 置空；删除团队（`server/src/routes/admin/teams.ts:124-134`）。最后才删除部门（`departments.ts:295-303`）。
- 整个过程没有事务。如果部门下还有子部门，最后一步会因 `parent_id` 外键（迁移 0037）失败并返回 500，但前面删除用量、清空审计归属的操作已经生效。如果 `static_file_owners.team_id`（RESTRICT）有引用，删除团队这一步也会失败，同样留下半完成的状态。
- 这与 CONTEXT.md"审计历史永久保留"的原则冲突：删除一个历史上产生过用量的空部门，会抹掉部门维度的用量和审计归属。

#### M11 Anthropic 失败路径透传上游错误体和状态码【已核实】（代码）；泄露内容取决于上游【推断】

- Anthropic Messages 最后一次尝试失败时，只要上游 body 是 `{type:"error",...}` 的形式，就连同上游状态码原样回给客户端（`server/src/routes/relay/anthropic-messages.ts:880-915`），包括上游的 401、403、429 和 5xx。OpenAI 路径只透传 4xx 参数错误，其余都统一映射（`server/src/routes/relay/chat-completions.ts:947-986`）。
- 影响：上游渠道 KEY 失效时，Claude Code 等客户端收到 401，会误以为平台 Key 失效；自建网关如果在错误信息中带有内部地址或 Key 片段，会直接暴露给员工。

#### M12 流式响应缺少 usage 时，按 0 记账【已核实】（代码）；上游是否默认返回 usage【推断】

- 审计在 usage 缺失时把 token 记为 0、积分记为 0，而且不写小时积分账本（`server/src/lib/relay/audit.ts:110-135`）。全仓库没有为 OpenAI 流式请求补 `stream_options.include_usage`（检索结果为 0）。如果客户端没有开启、上游也不默认返回 usage，这次调用就不会被计量，调度依赖的本地额度账本也会被低估。

#### M13 日志统计全表扫描，多个列表接口不分页【已核实】（热力图与分析聚合部分为【推断】）

- 调用日志列表在不传日期时，会对 `request_audits` 全表 `count(*)` 并关联员工表（`server/src/routes/admin/logs.ts:187-211`）；报错日志列表每次都做全表计数（`server/src/routes/admin/error-logs.ts:154-159`）。
- 不分页、一次返回全量的接口：`GET /api/admin/credentials`（`credentials.ts:1499` 起，只有可选过滤条件）、`GET /api/admin/channel-seats`（含手机号，`channel-seats.ts:109-134`）、`GET /api/admin/credential-submissions`（读取全部非超管员工，`credentials.ts:710-732`）、调度画布 `GET /api/admin/key-bindings`（`key-bindings.ts:51` 起）。
- 用户分析热力图和平台分析会在请求内对审计大表做大范围聚合，数据量上来后会变慢。

#### M14 生产依赖有已知高危公告，Node 版本约束不一致【已核实】

- `npm audit --omit=dev` 报告 16 个问题（高危 11、中危 5、严重 0）。涉及的直接依赖：`fastify@5.11.2`（包括 trustProxy 跳数场景下的 X-Forwarded-* 伪造、schema 校验绕过等，修复于 5.12.x）；`drizzle-orm@0.39.3`（SQL 标识符转义导致的注入，修复需要升级到 0.45.x，属于大版本）；`axios@1.19.0`；`vue@3.5.41`（SSR 场景下的 XSS，本项目不用 SSR）；`pptxgenjs`（没有任何引用，却引入了 `image-size` 的高危公告）。
- 可利用性：本项目没有使用 Fastify 的 JSON schema 校验，也没有发现用户可控的 SQL 标识符（`sql.raw` 只用于白名单内的时区），多数公告目前无法直接利用【推断】。但这些升级成本都很低。
- 版本约束：`@earendil-works/*` 要求 Node ≥22.19，`vue-stick-to-bottom` 要求 ≥22.22；`package.json` 声明的是 `^20.17.0 || >=22.9.0`，Dockerfile 使用浮动标签 `node:22-bookworm-slim`；`packageManager` 声明 npm 11.16，而本机是 npm 10.9。

#### M15 测试体系失修，没有 CI【已核实】

- 把 `server/test` 纳入类型检查会出现 30 个错误（分布在 13 个文件）。
- 10 个集成脚本中，只有 1 个干净通过；2 个断言通过但进程不退出；2 个在清理阶段因外键失败；4 个因为期望值过时而失败；1 个因需要真实上游而跳过（详见第 6 节）。仓库没有 CI，也没有 lint 配置。
- E2E 只从仓库根目录的 `.env` 读取连接信息，不读进程环境变量（`e2e/env.ts:8-16`），不方便在 CI 中运行。
- 与 AGENTS.md"优先 E2E、产出可复现产物"的要求相比，越权、停用、入部、敏感词拦截、多协议、分档调度等关键路径都没有 E2E。

#### M16 运维加固不足【已核实】

- Caddy 没有配置任何安全响应头，包括 HSTS、X-Content-Type-Options、Referrer-Policy、frame-ancestors / CSP（`deploy/Caddyfile:1-30`）。
- 备份只在本机做 `pg_dump | gzip`，保留 14 天，不加密，不包含 request-context 卷（`deploy/backup.sh:21-30`）；恢复演练文档已经缺失（见第 3.6 节）。
- compose 中存在死配置（`deploy/compose.yaml:76-77`）；镜像 tag 写死（`compose.yaml:53、108`），与 `package.json` 的 0.0.1 版本号对不上。

#### M17 自建网关的上游地址不限制内网与元数据地址（SSRF，仅超管可配置）【已核实】

- 自建网关（`custom`）和海致渠道的上游地址只校验了 http / https 协议（`server/src/lib/upstream-protocol-config.ts:26-49`，`server/src/lib/provider-templates.ts:252-266`），可以填写 `127.0.0.1`、`169.254.169.254` 等内网或元数据地址；连通性测试和正式转发都会带着渠道 KEY 向该地址发请求。
- 只有超管能配置这些地址，但超管会话存放在 localStorage；允许明文 http 也意味着渠道 KEY 和员工 prompt 可能以明文经过网络。
- 正面：官方模板渠道只允许文档列出的 HTTPS 主机（`provider-templates.ts:239-246`），上游 fetch 使用 `redirect: "manual"`（`server/src/lib/relay/upstream.ts:843`）。

### 4.3 低

| 编号 | 问题 | 证据 | 状态 |
|---|---|---|---|
| L1 | 席位登记在事务内先计数再插入，没有锁，并发登记可以超出席位数（提交渠道 KEY、修改或删除渠道都加了 advisory lock，唯独这里没有） | `server/src/routes/admin/channel-seats.ts:159-208` | 【已核实】 |
| L2 | Token Bot：Redis 故障时限流直接放行；"查邀请人"会加载所有启用企业的管理员姓名，不限定提问者所在企业；历史接口没有条数上限 | `server/src/lib/support-bot/rate-limit.ts:20-28`；`invite-contacts.ts:298-374`；`server/src/routes/support.ts:52-60` | 【已核实】 |
| L3 | 管理员录入的敏感词正则直接用 `new RegExp` 在热路径上匹配用户输入，只限制了长度 128 和数量 200，没有灾难性回溯防护（ReDoS） | `server/src/lib/relay/sensitive-words.ts:300-311、348-368` | 【已核实】 |
| L4 | 非流式响应默认最多缓冲 100MB（生产 compose 已改为 20MB） | `server/src/config.ts:58-62`；`chat-completions.ts:103-119`；`deploy/compose.yaml:74` | 【已核实】 |
| L5 | 硬编码：员工端 Base URL 写死为生产域名，预发和本地教程会引导用户连生产；首个超管有默认手机号和密码（`bootstrap-admin.sh` 会要求显式传入，但直接 `db:seed` 会用默认值） | `web/src/views/me/KeysView.vue:177`；`GuideView.vue:535`；`server/src/config.ts:90-92` | 【已核实】 |
| L6 | 部门管理员审核 `pending` 用户时只校验同企业，不校验部门 | `server/src/routes/admin/users.ts` | 【已核实】 |
| L7 | `db:cleanup-demo` 没有环境护栏，第一句删除的表早已不存在，所以当前一定失败；如果有人把它"修好"，会清空生产审计数据 | `server/src/db/cleanup-demo-data.ts:13-25`；`server/drizzle/0017_consumption_only_audits.sql:25` | 【已核实】 |
| L8 | 前端健壮性：HTTP 层不处理 403，4 个页面静默吞掉 403；Element Plus 全量注册，主包 1.1MB（gzip 后 369KB）；Vite 开发服务器监听 `0.0.0.0` | `web/src/api/http.ts:20-42`；`web/src/main.ts:3-4、13`；`web/vite.config.ts:30` | 【已核实】 |
| L9 | 非 GLM 渠道（DeepSeek、自建网关）的积分恒为 0，5 小时 / 每周额度避让对它们基本失效，只能依赖上游 429 | `server/src/lib/relay/credit-cost.ts:285-288` | 【已核实】 |
| L10 | RPM 计数先于并发检查扣减，并发被拒绝时 RPM 已经被占用一次 | `server/src/lib/relay/quota.ts:138-140` | 【已核实】 |
| L11 | 集成测试暴露了一处行为回归：期望按 Key 存储的协议返回 Anthropic 原生错误包，实际按请求头决定 | `server/test/mock-native-protocol-integration.ts:504-521`；`server/src/middleware/api-key.ts:209-216` | 【已核实】 |
| L12 | Fastify 开启 `trustProxy: true`；目前 API 端口没有对外发布，Caddy 默认会覆盖 X-Forwarded-For，风险较低。如果 API 直接暴露，审计 IP 可以被伪造 | `server/src/app.ts:30-34`；`deploy/compose.yaml:52-105` | 代码【已核实】，暴露面【推断】 |
| L13 | 开发用 compose 把 5432 和 6379 端口绑定在所有网卡上 | `deploy/compose.local.yaml:10-11、28-29` | 【已核实】 |
| L14 | 文档与术语不一致（README、ADR、FEATURE_LIST、CHANGELOG、渠道 / 模式术语、Key 是否绑定协议、缺失的 runbook） | 见第 3.6 节、第 2.6 节 | 【已核实】 |

---

## 5. 改进建议（按优先级）

### 高优先级（建议立即安排）

1. **收口初始密码与强制改密**（对应 H1、M1）
   - 理由：这是当前最容易被利用、影响面最广的问题。
   - 改动：删除 `REGISTRATION_INITIAL_PASSWORD`。批量注册和审核通过改为生成一次性随机密码并强制改密；LDAP 与钉钉开户的账号设置不可用的随机本地密码（这些用户本来就不需要本地密码）。登录时签发真实的 `mustChangePassword`；服务端增加全局 preHandler，`mustChangePassword` 为真时只放行改密与 `/api/auth/me`。JWT 增加签发时间与 `password_changed_at`（或 token 版本号）的比较；管理员重置后也强制改密。从前端文案中删除密码。写一个一次性修复脚本：对全部账号做 `bcrypt.compare('Hz123456')`，命中的账号强制改密或改为随机密码（约 1000 个账号，cost 10，一两分钟可以跑完）。
   - 范围：`server/src/lib/password.ts`、`routes/auth.ts`、`middleware/auth.ts`、`lib/jwt.ts`、`routes/admin/users.ts`、`lib/ldap-dingtalk-provision.ts`、`db/sync-dingtalk-users.ts`，以及 `web/src/router/index.ts`、`EnterprisesView.vue`。中等改动；如果加 token 版本号，需要 1 个迁移。

2. **部门管理员的范围改为"任命制"**（对应 H2）
   - 理由：目前范围由成员关系推导，被邀请进另一部门即扩大管理范围。
   - 改动：新增"部门管理员任命"关系（独立表，或在成员关系上恢复管理员标记），`listAdminDepartmentIds` 只读取任命关系。
   - 范围：schema 加 1 个迁移；`server/src/lib/org.ts`、`routes/admin/users.ts`、`teams.ts`、`departments.ts`、`overview.ts` 中的范围计算。中到大改动，需要补 E2E。

3. **身份绑定改为强校验**（对应 H4、H5）
   - 理由：手机号和姓名都不是可信的身份凭据。
   - 改动：注册时验证手机号归属（短信验证码，或钉钉扫码 / 免登取得 userid）。`employees` 已有 `dingtalk_userid`，补唯一约束并增加 `ldap_uid` 唯一列；LDAP 登录只按已绑定的 uid 或 LDAP 手机号精确匹配；删除姓名匹配和"钉钉同名后按手机号返回已有账号"的逻辑；不再把整张员工表读进内存。
   - 范围：`server/src/routes/auth.ts`、`lib/ldap-auth.ts`、`lib/ldap-dingtalk-provision.ts`、`lib/dingtalk-register-join.ts`，schema 加 1 个迁移。中等改动。

4. **统一租户生命周期**（对应 H3）
   - 理由：停用必须能立即止损。
   - 改动：relay 鉴权关联企业与部门状态（一个 join 即可），或者在停用企业或部门时同步 `teams.status` 并批量吊销 Key；补一条 E2E："停用企业后 Key 调用返回 401/403"。
   - 范围：`server/src/middleware/api-key.ts`、`routes/admin/enterprises.ts`、`routes/admin/departments.ts`。小改动。

5. **数据保留与访问审计**（对应 H6）
   - 理由：属于合规底线，而且磁盘按每天 GB 级增长。
   - 改动：制定保留期限（例如请求全文 90 或 180 天，敏感词预览 180 天，Token Bot 消息 90 天），实现定时清理。内容寻址的 blob 需要按引用做"标记—清除"，可以借助 `static_file_owners` 和 envelope 引用。查看与下载全文时写操作审计；评估文件级加密（可以复用 `crypto-secret.ts`）；向员工告知数据处理规则；在备份策略中明确 request-context 卷是否备份。
   - 范围：`server/src/lib/relay/request-context.ts`、新的清理任务、`routes/admin/logs.ts`、`deploy/backup.sh`。较大改动。

6. **把个人信息移出仓库和镜像**（对应 H7）
   - 理由：花名册已进入 git 历史和生产镜像。
   - 改动：删除 `server/data/haizhi-org.json`，改为运行时从钉钉拉取，或通过 `ORG_CHART_PATH` 指向仓库外的文件；Dockerfile 不再复制 `server/data`；`PINNED_HEAVY_EMPLOYEE_IDS` 改为配置项或数据库字段；`SEED_ADMIN_PHONE` 默认值改为占位符；评估是否需要 `git filter-repo` 清理历史并通知所有克隆方。
   - 范围：代码改动小，但涉及仓库治理决策。

### 中优先级

7. **修复迁移体系**（对应 M8、M9）：迁移器加 `pg_advisory_lock`；journal 表加唯一约束并校验 hash；把 `usage_counters_daily` 的全量回填移到一次性迁移中；按当前 schema 补齐基线 snapshot；schema 中补上 `departments.parent_id` 的外键声明；把 0044 的触发器写进文档，或改为在应用层赋值；在 CI 中加入"迁移库与 schema 生成库的 `pg_dump` 对比"（本次已验证可行）；把迁移改为独立的一次性 job，而不是 api 的启动命令。范围：`server/src/db/migrate.ts`、schema、`drizzle/meta`、Dockerfile 与 compose。
8. **修正绑定调度**（对应 M6、M7、M8）：企业共享只移除当前成员，只有确实需要时才删除整行；建绑定和加入首个成员放进同一事务；`releaseOrphanBindings` 移出热路径，并给新建绑定留宽限期；后台任务用 `pg_try_advisory_lock` 选主；删除每次请求的 `departments` 全表查询；给 `(relay_pool_key, scope_type, scope_id)` 建普通索引。范围：`lib/relay/binding.ts`、`tier-rebind.ts`、`idle-binding-release.ts`、`capacity-alert.ts`，加 1 个迁移。
9. **统一权限口径并补齐审计**（对应 M3、M4、M5）：明确企业和部门管理员能否看员工调用明细，让文档和接口一致；每次扮演开始时写审计，扮演期间的写审计带上 `actAs`；员工 Key 只在创建或轮换时显示一次，或者改为单独的 reveal 接口并记审计。范围：`routes/admin/users.ts`、`overview.ts`、`middleware/auth.ts`、`routes/me.ts`、`web/src/views/me/KeysView.vue`。
10. **删除部门改为停用，或至少做成事务并检查子部门**（对应 M10）。范围：`routes/admin/departments.ts`、`teams.ts`。小改动。
11. **Relay 正确性**（对应 M11、M12、M17、L4）：OpenAI 流式请求补 `stream_options.include_usage`；Anthropic 路径对上游 401、403、429、5xx 统一映射；自建网关地址拒绝回环、链路本地和元数据网段，内网地址按需白名单；调低 `RELAY_RESPONSE_MAX_BYTES` 的默认值。范围：`routes/relay/*.ts`、`lib/upstream-protocol-config.ts`、`config.ts`。小到中改动。
12. **升级依赖**（对应 M14）：fastify 升到 5.12.5 以上，axios 升到 1.20 以上，vue 升到 3.5.42 以上；drizzle-orm 升到 0.45.x 需要回归测试；删除未使用的 `pptxgenjs`、`marked`、`sanitize-html`；把 Node 运行时与依赖的 engines 对齐到 22.22 以上，并固定 Docker 基础镜像的 digest。
13. **重建测试体系与 CI**（对应 M15）：修复测试代码的 30 个类型错误，并把测试纳入类型检查；修复或淘汰 10 个集成脚本，优先迁移为 Playwright E2E，符合 AGENTS.md 的要求；`e2e/env.ts` 支持从环境变量读取配置；新增 CI，依次运行类型检查、单测和 E2E（使用 Postgres 与 Redis service），并上传 HTML 和 JSON 报告作为产物。补充的 E2E 场景：越权、停用企业、敏感词拦截、Anthropic 与 Responses 协议、闲置释放。
14. **运维加固**（对应 M16、L13）：Caddy 加上 HSTS、`X-Content-Type-Options`、`Referrer-Policy`、`frame-ancestors`；备份加密并异地存放，定期做恢复演练；补回 runbook；删除 compose 中的死配置；开发 compose 的端口绑定到 127.0.0.1。
15. **查询性能**（对应 M13）：日志列表设置默认时间窗口和最大跨度，计数改为估算或加超时；渠道 KEY、席位、提交记录、调度画布接口加分页，或要求按渠道过滤；用户热力图改为读取预聚合表。

### 低优先级

16. **结构清理**：拆分 `credentials.ts`、`me.ts`、`users.ts`、`overview.ts` 和超大的 Vue 组件；把两条 relay 路由共用的"尝试循环"和两份 SSE 透传抽成公共实现；把 `/api/admin/teams` 改名为部门成员 API（保留兼容入口）；删除不可达分支、死配置和未使用的导出；在 `.gitignore` 中加入 `web/.vite`、`.zcode` 并移除已跟踪的文件；引入 ESLint 与 Prettier（或 Biome）。
17. **前端体验与类型**：HTTP 拦截器统一处理 403；应用启动时调用一次 `/api/auth/me` 校正本地角色；Element Plus 改为按需引入；Base URL 改为读取 `location.origin`；清理 19 处 `any`。
18. **文档对齐**：更新 README 中的文档列表；给 ADR 0001、0003、0004 标注已被取代；更新 FEATURE_001 的状态；清理 CHANGELOG 中的重复和旧口径；在 CONTEXT.md 中补充 UI 里"渠道 / 模式"的新含义；先决定 Key 是否真的绑定协议，再统一 CONTEXT、接入教程和代码。
19. **其他低风险项**：席位登记加 advisory lock（L1）；Token Bot 限流加兜底、查邀请人限定本企业、历史记录分页（L2）；敏感词正则改用 RE2 或加超时（L3）；非 GLM 渠道的积分系数改为可配置（L9）。

---

## 6. 本次验证执行记录

以下命令与结果是原审查对 `9f96611` 的实测（迁移当时到 0054）。其后 journal 已到 `0060`，E2E 增加了编制层级 spec。

环境：Ubuntu 24.04，Node v22.14.0，npm 10.9.9，没有 Docker。PostgreSQL 16.15 与 Redis 7.0.15 用 apt 安装在审查用的虚拟机内，连接信息只写在 `/tmp` 下的环境文件中，没有在仓库里创建 `.env`。"执行者"一列中，"主审"表示主审亲自运行，"子审查"表示由子代理运行、主审抽查过原因或产物。

| 步骤 | 命令 | 结果 | 执行者 |
|---|---|---|---|
| 安装依赖 | `npm ci` | 通过，约 8 秒，518 个包；有 EBADENGINE 警告（Node 22.14 低于部分依赖要求的 22.19 / 22.22；npm 版本与 `packageManager` 不一致） | 子审查 |
| 生产依赖审计 | `npm audit --omit=dev` | 16 个问题：高危 11、中危 5、严重 0（加上开发依赖共 21 个，其中开发依赖树中 `shell-quote` 为严重） | 主审 |
| 服务端类型检查 | `npx tsc -p server/tsconfig.json --noEmit` | 0 个错误 | 主审 |
| 测试代码类型检查 | 临时 tsconfig（放在 `/tmp`）把 `server/test/**` 纳入检查 | 30 个错误，分布在 13 个文件 | 主审 |
| 前端类型检查 | `cd web && npx vue-tsc -b` | 0 个错误 | 主审 |
| 单元测试 | `npm test --workspace=@kodax-fabric/server` | 184 通过、0 失败，约 6.9 秒 | 主审 |
| 构建 | `npm run build` | 通过，约 22 秒；Vite 提示存在超过 500KB 的 chunk：主包 1,109KB（gzip 369KB）、UsageChart 566KB、ActAsDrawer 424KB | 子审查（主审核对了 `web/dist` 的实际体积） |
| 迁移与 seed | 对空库执行 `db:migrate`、`db:seed` | 通过，从 0000 迁移到 0054，各约 0.7 秒 | 子审查 |
| Schema 漂移检查 | 库 A：仓库迁移；库 B：`drizzle-kit generate` 从 schema 生成全新 SQL（421 行）后执行；两库做 `pg_dump --schema-only` 与 `information_schema` 对比 | 表、列、类型、默认值、索引、枚举完全一致；差异为 `parent_id` 外键、0044 的函数与触发器、一条列注释 | 子审查（主审核对了对应 SQL 与 schema 行） |
| `db:generate` 现状 | 在 `/tmp` 下的仓库 drizzle 副本上运行 `drizzle-kit generate` | 进入交互式重命名确认，无法非交互完成，原因是 snapshot 只到 0023 | 子审查 |
| E2E | `npx playwright install --with-deps chromium` 后运行 `npx playwright test` | 5/5 通过，用例耗时 13.2 秒；`e2e/env.ts` 只读仓库根目录的 `.env`，运行期间临时用软链指向 `/tmp` 下的环境文件，结束后已删除 | 子审查（主审核对了 `e2e-results.json`：expected 5、unexpected 0、flaky 0） |
| 工作区检查 | `git status --porcelain` | 为空（`node_modules`、`dist`、`playwright-report` 等都在 `.gitignore` 中） | 主审 |

**集成脚本逐个结果**（子审查执行；第三列的原因主审抽查过测试代码）：

| 脚本 | 结果 | 原因 |
|---|---|---|
| `test:v003:integration` | 通过 | — |
| `test:v001:binding` | 断言打印 ok，但进程不退出，约 3.5 分钟后被强制结束 | 连接或句柄没有关闭 |
| `test:relay:mock` | 断言打印 ok，但进程不退出，90 秒超时；审计中的 `retryCount` 全为 null | 同上；测试仍读取已删除的字段 |
| `test:enterprise:isolation` | 失败 | 清理阶段删除企业时触发 `teams` 外键（没有先删除自动创建的默认团队） |
| `test:enterprise:launch` | 业务断言通过，清理失败 | 同上 |
| `test:registration` | 失败 | 仍按旧的注册请求体 `{kind, name, dept, phone}` 调用（`server/test/registration-approval.integration.ts:104-108、124-125`），现在的接口要求 `{name, phone, password}` |
| `test:v001:api` | 失败 | 期望企业管理员访问 `/api/me/*` 返回 403（`server/test/v001-api-key-integration.ts:495`），现在会放行 |
| `test:binding:scheduling` | 失败 | 期望 200，实际 403 |
| `test:relay:native:mock` | 失败 | 期望按 Key 存储的协议返回 Anthropic 错误包（L11） |
| `test:relay:live` | 跳过 | 需要真实上游与运行中的服务 |

没有测试真实的钉钉、LDAP 和上游模型调用，也没有对生产库做任何查询。

---

## 附录：已排除的疑点与做得好的地方

**已排除的疑点**（均为【已核实】）

| 疑点 | 结论与依据 |
|---|---|
| SQL 注入 | 用户输入全部通过 drizzle 参数绑定；用户搜索的 ILIKE 对 `% _ \` 做了转义（`server/src/routes/admin/users.ts:100-106`） |
| LDAP 注入与匿名 bind | 用户名白名单，空密码直接拒绝（`server/src/lib/ldap-auth.ts:21-23、77`） |
| JWT 算法混淆 | 固定使用 HS256 对称密钥签发和校验（`server/src/lib/jwt.ts:59、67`） |
| 渠道 KEY 与员工 Key 的加密 | AES-256-GCM，每次随机 IV，校验 tag，按用途派生密钥（`server/src/lib/crypto-secret.ts:10-37`） |
| 吊销延迟 | API Key 鉴权每次查库，不经缓存（`server/src/middleware/api-key.ts:116-138`） |
| 员工接口 IDOR | `/api/me/*` 中带 `:id` 的操作都以本人为条件；Token Bot 查请求会校验归属（`server/src/lib/support-bot/lookup-request.ts:82-84`） |
| 员工提交渠道 KEY 绕过测试 | 提交时必须携带测试凭证，并经服务端校验（`server/src/routes/me.ts:535-573`） |
| 扮演提权到超管 | 只有真实超管才解析扮演头，扮演目标不能是 admin（`server/src/middleware/auth.ts:86-108`） |
| 流式重试导致内容重复 | 首包交给客户端之后不再换 Key；客户端断开时通过 `req.signal` 中止上游（`server/src/routes/relay/chat-completions.ts:608`） |
| SSE 多字节字符被截断 | `TextDecoder` 以 `stream: true` 增量解码（`server/src/lib/relay/sse.ts:168、215`） |
| 把客户端凭据转发给上游 | 转发头使用白名单，过滤换行和超长值（`server/src/lib/relay/upstream.ts:671-684`）；上游请求 `redirect: "manual"`（`upstream.ts:843`） |
| 请求上下文路径穿越与密钥落盘 | requestId 与 blob 哈希有正则约束；鉴权头和密钥字段在落盘前打码（`server/src/lib/relay/request-context.ts:28-36`） |
| 审计重复计数 | `request_audits.request_id` 唯一，冲突时整笔跳过（`server/src/lib/relay/audit.ts:137-161`） |
| 前端 XSS 汇点 | `web/src` 中没有 `v-html` 或 `innerHTML`；日志 JSON 以文本方式渲染 |
| 登录页开放重定向 | vue-router 4 的 history 模式会把 `redirect` 拼在当前源之后（`node_modules/vue-router/dist/vue-router.mjs:124`），`//evil.example` 会变成同源路径，不会跳出站点 |
| 员工被物理删除 | 没有删除员工的接口，只能停用；审计相关表对员工的外键为 NO ACTION |
| 删除渠道时丢失调用日志 | 在一个事务内加 advisory lock 后级联清理，`request_audits` 对渠道没有外键，日志行保留（`server/src/routes/admin/providers.ts:602-679`） |

**做得好的地方**

- Relay 的工程质量较高：pull 模式透传并带背压，首包确认后才交接，客户端断开会中止上游；429 按报文学习额度窗口，本地额度账本只用于避让、不写冷却；落盘前对密钥打码，内容寻址去重把磁盘增量降低了约 84%。
- 绑定使用唯一索引、`ON CONFLICT DO NOTHING` 加回读，企业共享加成员时使用 `FOR UPDATE` 和容量检查。
- 渠道相关的写操作（删除渠道、提交 KEY、修改渠道配置、签发 Key）使用 advisory lock，需要多把锁时先按 key 排序再依次获取，避免死锁（例如 `server/src/routes/me.ts:1116-1119`）。
- 服务端严格模式、零 `any`，zod 校验覆盖面广；领域规则以纯函数实现并有单测，184 个单测运行很快。
- E2E 设计符合"可复现产物"的要求：每次运行都会建库、重置、迁移、seed，并输出 HTML 和 JSON 报告。
- CHANGELOG 记录详细，包含设计取舍和实测数据，方便追溯。
