# KodaX Fabric 项目理解与待解决问题

> 分析日期：2026-10-12，分支 `dev`（含未提交的钉钉同步改动）。
> 依据：只看代码、迁移、部署文件和测试，`docs/`、`README`、`CHANGELOG` 等文档未作为事实来源。
> 范围说明：后端转发链路、绑定调度、计费、鉴权、迁移、部署逐文件读过；管理端路由和前端只看了结构与路由/鉴权；**没有运行任何测试或构建**，下面的"问题"都是读代码得出的，标了"待确认"的需要用真实数据验证。

---

## 一、这个项目是什么

一句话：**企业内部的大模型 Key 共享网关**。公司买了一批上游官方 Key（主要是智谱 GLM Coding Plan 套餐），员工不直接拿官方 Key，而是在平台上领一个 `th_` 开头的虚拟 Key；请求打到网关后，网关按"谁在用、用多少"把虚拟 Key 动态绑定到某个真实上游 Key 上转发，并记录用量、积分和完整请求内容。

代码里的名字有三套并存：包名和页面叫 **KodaX Fabric**，服务日志、Redis key、响应头、compose 项目名叫 **TokenHub**，域名是 `tokenhub.haizhi.com`。

### 技术栈

| 层 | 实现 |
|---|---|
| 后端 | Node 22 + Fastify 5 + TypeScript，Drizzle ORM + postgres.js，ioredis，zod，jose（JWT），ldapts |
| 前端 | Vue 3 + Vite + Pinia + Element Plus + Tailwind 4，ECharts，Vue Flow（Key 绑定关系图） |
| 存储 | PostgreSQL 16（业务 + 计量），Redis 7（仅限流/并发），本地磁盘卷（请求全文） |
| 部署 | 单机 Docker Compose：postgres / redis / api / web(Caddy)，内网 IP `10.10.0.144`，容器启动时自动跑迁移 |
| 测试 | `node:test` 单测 15 个文件约 180 例；Playwright E2E 3 个 spec 共 10 例；另有 9 个手动跑的集成脚本 |

---

## 二、核心业务模型（以 `server/src/db/schema/index.ts` 为准）

### 组织

- `enterprises`：企业，带 `parent_id`（集团 → 子公司）和 `dingtalk_dept_id`。
- `departments`：部门树（`parent_id` 自引用，但**没有外键约束**），带钉钉部门 ID。
- `teams`：挂在部门下。每个部门有一个默认 team，实际上 team 就是"部门成员关系"的载体，`team_members` 允许一人多部门。
- `employees`：登录账号用手机号；角色 `employee / dept_admin / org_admin / admin`；大量钉钉资料字段（工号、主管、部门列表、角色列表等）。

### 上游渠道

- `providers` → `product_lines`（一个"渠道/套餐"）→ `upstream_credentials`（真实上游 Key，AES-256-GCM 加密存储）。
- `product_lines.relay_pool_key`：调度池。所有智谱 Coding Plan 套餐共用一个池 `glm:coding_plan`，其他渠道一条线一个池。
- `channel_seats`：席位。管理员给员工登记席位，员工凭席位**自己提交**购买到的上游 Key 入池。
- `model_routes`：客户端模型名 → 上游模型名的可选映射；没配就透传。

### 虚拟 Key 与绑定

- `employee_api_keys`：员工虚拟 Key，绑定 `product_line_id` 和 `team_id`。同时存了哈希（鉴权用）和**可逆密文**（页面上可以反复查看明文）。
- `credential_bindings`：一把上游 Key 当前归谁用（唯一约束：一把 Key 只能有一个绑定）。
- `credential_binding_members`：企业共享绑定下的成员名单。

### 计量

- `request_audits`：每次请求一行，只存元数据和 token/积分。
- `request_error_logs`、`sensitive_word_hits`、`ops_audit_logs`。
- `usage_counters_daily` / `usage_counters_team_daily`：按天预聚合。
- `credential_usage_hourly`：每把上游 Key 的小时积分账本，用来估算 5 小时/周额度。
- `static_files` / `static_file_owners`：磁盘上请求全文内容块的索引。

---

## 三、一次请求是怎么走的

入口支持三种协议，路径有带 `/ai` 前缀和不带的两套（`server/src/lib/relay/protocol.ts`）：

- OpenAI Chat：`/v1/chat/completions`
- OpenAI Responses：`/v1/responses`
- Anthropic Messages：`/v1/messages`、`/v1/messages/count_tokens`

流程（`routes/relay/chat-completions.ts`，Anthropic 那份结构相同）：

1. **鉴权**（`middleware/api-key.ts`）：从 `Authorization` 或 `x-api-key` 取 `th_` Key，查哈希，校验员工状态、角色、是否仍在 Key 绑定的 team 里。
2. **敏感词**（`lib/relay/sensitive-words.ts`）：命中可只记录，也可拦截并伪装成智谱的内容安全错误。
3. **限流**（`lib/relay/quota.ts`）：Redis 做每人每分钟请求数和并发数，默认 60 RPM / 5 并发（生产 compose 配的是 15 并发）。这里只有保护性限流，**没有按人或按部门的 token 配额**。
4. **选上游 Key**（`lib/relay/routing.ts` + `binding.ts`），见下一节。
5. **调上游**（`lib/relay/upstream.ts`）：失败可换 Key 重试，最多 `RELAY_MAX_ATTEMPTS` 次；401/403 自动禁用该 Key；429 解析智谱业务码（1308/1310 等）识别"5 小时上限/周上限"，按上游给的重置时间冷却。
6. **流式透传**（`lib/relay/sse.ts`、`native-sse.ts`）：先读到首个非空 chunk 才向下游交付，交付前失败还能换 Key。
7. **落账**（`lib/relay/audit.ts`）：一个事务写审计行、错误日志、两张日计数表、小时积分账本，更新 Key 最近使用时间；然后异步把请求/响应全文写磁盘。

### 上游 Key 的分配规则（项目里最复杂的部分）

每个员工按**最近 7 天日均 token** 分档（`lib/usage-tier.ts`）：

| 档位 | 条件 | 拿到什么 |
|---|---|---|
| heavy 重度 | 日均 ≥ 3000 万 token；或注册不满 7 天；或在硬编码名单里 | 独占一把上游 Key |
| standard 标准 | 有调用但没到重度 | 与同企业其他人共享，一把 Key 最多 5 人 |
| idle 闲置 | 7 天零调用 | 不占 Key，发起请求时临时升为标准 |

配套机制：

- 额度避让：本地账本估算到 5 小时额度的 85% 或周额度的 95% 就主动换 Key，但只有上游真返回 429 才写冷却状态。
- 5 小时窗口按"首次使用时刻"锚定，周窗口按从 429 报文学到的重置时刻滚动，都存在 `upstream_credentials` 上。
- 三个进程内定时任务（`index.ts`）：容量告警（冷却占比超阈值发 webhook）、每分钟释放 2 小时没调用的绑定、每天重算档位并重新绑定。
- `custom` 供应商是"开放池"：不分档、不独占，谁有虚拟 Key 都能用。
- 积分按智谱官方系数表硬编码计算（`lib/relay/credit-cost.ts`），14–18 点高峰 1 倍、其他时段 0.5 倍。

---

## 四、其他功能模块

- **登录**：手机号 + 密码；LDAP 公司账号登录（验证通过后按手机号/姓名匹配员工，匹配不到就去钉钉拉资料自动建号）；开放注册（注册即激活，再尝试按钉钉通讯录自动归入企业部门）。
- **权限**：`admin` 全局；`org_admin` / `dept_admin` 限定企业/部门范围（`lib/enterprise.ts`、`lib/org.ts`）；超管可通过 `X-Act-As` 请求头临时扮演下级角色查看（`lib/act-as.ts`）。
- **钉钉同步**：全部是手动执行的 CLI 脚本（`server/src/db/sync-dingtalk-*.ts`、`align-haizhi-dingtalk-org.ts` 等），服务运行时只有注册和 LDAP 建号两处会调钉钉 API。当前未提交的改动正在加"部门树同步"和"成员关系同步"（先出计划、可导出 SQL 人工执行）。
- **管理端**：渠道与 Key 管理、Key 看板（按状态分泳道）、绑定关系实时图、用量分析、用户分析、调用日志（可看请求全文）、错误日志、敏感词与命中记录、操作审计、系统设置。
- **客服机器人**（`lib/support-bot/`）：员工在页面里问问题，后端带着账号上下文和知识库文档调用模型回答，可用工具查自己的请求记录；模型调用走专用 Key 或直接从池里取一把。

---

## 五、需要解决的问题

按我判断的严重程度排序。

### A. 安全

**A1. 统一初始密码且不强制修改（高）**
`lib/password.ts` 里 `REGISTRATION_INITIAL_PASSWORD = "Hz123456"`，被审批通过、批量注册、LDAP 自动建号、所有钉钉导入脚本共用；全仓库没有任何地方把 `mustChangePassword` 设为 `true`（迁移 0046 把它改成了可选），登录时还固定返回 `false`。结果是：凡是通过导入建的账号，知道同事手机号就能用 `Hz123456` 登录，进去后能看到对方虚拟 Key 明文和调用记录。
建议：导入账号改为随机密码或只允许 LDAP 登录；至少恢复首次登录强制改密。

**A2. 登录接口没有防爆破（高）**
`/api/auth/login`、`/api/auth/login-ldap`、`/api/auth/register` 都没有频率限制、失败计数或验证码。和 A1 叠加后风险更大；LDAP 接口还会被当成对公司 LDAP 的撞库跳板。

**A3. 请求全文永久明文落盘（高，需业务决策）**
`lib/relay/request-context.ts` 把每次请求的完整 prompt、响应、附件写到磁盘卷，文件头注释写明 "Retention is unlimited by design"。只对请求头和几个字段名做了脱敏，正文不脱敏、不加密。这等于保存了全员所有代码和对话内容，超管可在日志页查看。
需要明确：保留多久、谁能看、是否告知员工、磁盘满了怎么办（目前没有任何清理和容量监控）。

**A4. 虚拟 Key 可逆存储（中）**
`employee_api_keys.key_encrypted` 让页面可以随时回显明文，方便但意味着数据库 + `CREDENTIAL_ENCRYPT_KEY` 泄露等于全部虚拟 Key 泄露。且加密上游 Key 和虚拟 Key 用的是同一个根密钥，没有轮换机制。

**A5. 会话无法主动失效（中）**
JWT 有效期 7 天，存 `localStorage`；改密码后旧 token 仍然有效（禁用账号会生效，因为每次请求都回库查状态）。

**A6. 其他**
- `config.ts` 里种子管理员有默认手机号和默认密码 `Pwd@2026`，生产若没覆盖环境变量就是弱口令。
- LDAP 登录按**姓名唯一**兜底匹配员工（`matchEmployeeForLdapPerson`），重名情况消失或出现时会匹配到不该匹配的人。
- 本地 `backups/` 目录放着多份生产库导出（已 gitignore，但在开发机上明文存在），`key/` 目录用于放明文上游 Key。

### B. 正确性（待确认项需要用真实数据验证）

**B1. 目录模型会绕过 Key 自己的渠道，且选线不确定（待确认，可能较严重）**
`routing.ts` 的 `resolveRelayBoundCandidate`：只要模型名能在 `CLIENT_MODEL_CATALOG` 里匹配到（包括 `glm-5.3`、`glm-5.3-flash`、`deepseek-flash` 这些**别名**），就不用虚拟 Key 绑定的 `productLineId`，改用 `findActiveProductLineIdByProviderCode`。而这个函数是 `limit 1` 且**没有 `ORDER BY`**。智谱下面有多条产品线（迁移脚本里出现过 `api`、`api_intl` 和 Coding Plan 套餐），选到哪条取决于数据库返回顺序。如果选到的是按量付费的 `api` 线而不是 Coding Plan 池，请求会走错渠道、计错费。
另外带前缀的模型名（`deepseek/xxx`）可以让一个智谱渠道的 Key 调到别的供应商，是否符合预期需要确认。

**B2. 虚拟 Key 的协议字段没有被校验（待确认是否有意）**
`employee_api_keys.protocol` 鉴权时查出来了但没用，`principal.protocol` 取的是访问路径对应的协议。也就是任何虚拟 Key 都能打三种协议的端点。如果是有意放开，这个字段和前端"按协议建 Key"的交互就是多余的。

**B3. 重度独占 + 新号默认重度，Key 池容易被占满**
新账号 7 天内固定重度，每人独占一把 Key。批量导入一批人并且都开始使用时，池子里有多少把 Key 就只能服务多少人，后来的人会拿到"渠道冷却中"。靠 2 小时空闲释放缓解，但高峰期不够。硬编码的重度名单 `PINNED_HEAVY_EMPLOYEE_IDS = [100]` 也应该挪到配置或数据库。

**B4. 本地额度账本和上游真实额度会漂移**
账本按 UTC 整点分桶，锚点在小时中间时会少算；流式请求被取消或没收到 `usage` 时不记积分；Key 在平台外被使用完全看不到（代码里已有 `externalDrain` 记录这种情况）。目前是"估算避让 + 429 兜底"，可接受，但看板上显示的剩余额度不能当真。

**B5. 绑定操作不在事务里**
`binding.ts` 里"删旧绑定 → 选 Key → 插入 → 重读"是多条独立语句，靠唯一索引和重试兜底。并发下不会绑错，但会出现无谓的解绑/重绑和偶发的"无可用 Key"。

**B6. 部署配置和代码不一致**
`deploy/compose.yaml` 配了 `AUDIT_BODY_KEEP_LAST`、`AUDIT_BODY_PRUNE_INTERVAL_MS`，代码里已经没有这两个配置项——说明曾经有的审计清理逻辑被删了，但运维侧可能还以为它在工作。

### C. 性能与扩展性

**C1. 每次请求的数据库往返过多**
粗数一次成功请求在调上游之前有 15 次以上查询，其中包含 2 次"恢复过期冷却"的 `UPDATE`、1 次全表读 `departments`（`firstLevelDepartmentIdFromDb`）、重复两遍的池加载；之后还有标记成功的 `UPDATE` 和一个 5–6 条语句的落账事务。连接池上限 10。人数上来后数据库会先成为瓶颈。鉴权结果、调度池、部门树都适合做短时缓存。

**C2. 只能单实例运行**
并发计数、调度负载、绑定关系图的实时数据都在进程内存（`credential-load.ts` 注释里写明了这个假设）；三个定时任务没有分布式锁。现在多起一个副本就会出现重复告警、重复重绑和负载统计失真。

**C3. 数据只增不减**
`request_audits`、错误日志、敏感词命中、操作审计、小时账本、磁盘请求全文都没有清理或归档；`request_audits` 没有分区。

**C4. 每次启动全量重算日用量**
`db/migrate.ts` 在迁移之后固定执行"从 `request_audits` 全表聚合并覆盖 `usage_counters_daily`"，而 Dockerfile 每次启动容器都先跑迁移。审计表越大启动越慢，而且会覆盖计数表（两边按天归属的口径略有差异：写入时用落账时刻，重算时用 `created_at`，基本一致但不是同一个值）。应改成一次性迁移。

**C5. 个别明显的全表读**
LDAP 登录每次 `select * from employees`；档位变化时 `releaseOrphanBindings` 读全部员工、成员关系、部门、绑定。

### D. 工程与可维护性

**D1. Drizzle 快照停在 0023，迁移已到 0060**
`server/drizzle/meta/` 只有前 24 个快照，后面 37 个迁移是手写 SQL。现在运行 `npm run db:generate` 会拿当前 schema 和 0023 的快照做差异，生成一个巨大且错误的迁移。要么补齐快照，要么去掉这个脚本并写明"迁移只手写"。同时 schema 与手写 SQL 是否完全一致没有任何自动校验（我只抽查了十几个列名，都能在迁移里找到）。

**D2. 测试策略与项目约定不符，且没有 CI**
`AGENTS.md` 要求以 E2E 为唯一主要手段、不要事后补单测；实际是 15 个单测文件为主，E2E 只有 3 个 spec。最复杂、最容易出错的部分——分档绑定、共享满 5 人、额度避让、429 冷却、换 Key 重试、流式中断——只有手动执行的集成脚本覆盖，不在 `npm test` 里。仓库里没有任何 CI 配置。仓库里留存的 `e2e-results.json` 是 10 月 8 日的结果（5 例通过），比当前 spec 数量少，说明新增用例后的结果没有留档。

**D3. 巨型文件**
`routes/admin/credentials.ts` 2147 行、`routes/me.ts` 1608 行、`lib/relay/binding.ts` 1411 行、两个 relay 路由各 1000+ 行且大量重复；前端 `EnterprisesView.vue`、`TempChannelsView.vue`、`CredentialsView.vue`、`KeyBindingsView.vue` 都在 1500 行以上。两个 relay 路由的重试/流式/落账逻辑应抽成一份。

**D4. 钉钉同步是人工流程**
组织架构、人员、成员关系的同步全靠人在本机跑脚本（有的还要导出 SQL 再到生产执行），没有定时同步，也没有离职自动停用的闭环。部门/企业与钉钉的对应关系里有不少写死的名称和 ID（如 `SKIPPED_DINGTALK_PATHS`、`SKIP_MEMBERSHIP_DING_IDS`）。当前未提交的工作正是在补这一块，建议做完后落成一个可重复、幂等、可定时的任务。

**D5. 业务常量硬编码在代码里**
模型目录（只有 3 个模型）、积分系数、高峰时段、重度阈值、共享人数上限、周额度纪元时间、智谱国内网关地址都在源码里，改任何一个都要发版。`/api/admin/model-prices` 接口和页面还在，但 `getModelCreditRate` 已经只返回内置默认值，页面上的"自定义价格"实际不生效（迁移 0022 删了价格表）。

**D6. 遗留与杂项**
- `KodaX Fabric` / `TokenHub` 命名混用。
- 绑定范围枚举里的 `team`、`department` 已经没有代码会产生，只剩 `employee` 和 `enterprise`。
- `web/.vite/deps/` 被提交进了仓库。
- 根 `package.json` 依赖了 `pptxgenjs`，代码里没有引用。
- 根目录有 `.cursor`、`.devin`、`.zcode`、`.agent` 多套 AI 工具配置。
- 最近的提交信息是 "Implement feature X to enhance user experience…" 这类无信息量的模板句，历史难以追溯。

---

## 六、建议的处理顺序

1. **先堵安全口子**：A1（初始密码）、A2（登录限流），都是小改动。
2. **确认 B1、B2**：用生产数据查一下目录模型请求实际落到了哪条产品线，确认是否有走错渠道的情况。
3. **对 A3 做业务决策**：请求全文的保留期、访问范围、告知方式，然后补清理任务和磁盘监控。
4. **把手动集成脚本接进自动化**：至少把绑定调度和 mock 上游两条链路做成 E2E 并上 CI，之后才敢动 C1 和 D3。
5. **修 D1 和 C4**：迁移工具链和启动重算，属于"哪天会突然出事"的隐患。
6. **再做性能和结构**：请求路径缓存（C1）、数据清理（C3）、合并两个 relay 路由（D3）、钉钉同步任务化（D4）。
7. 多实例（C2）在单机够用之前可以不动，但要在部署说明里写明"只能跑一个 api 副本"。
