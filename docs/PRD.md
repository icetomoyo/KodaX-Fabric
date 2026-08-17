# KodaX Fabric — 产品需求文档（PRD）

> **产品类别**：企业级 Token 统一接入管理和服务平台
> **定位**：Token Hub + Token ROI —— 统一接入所有 LLM API，衡量 Token 投入产出
> **开发模式**：单人 + AI coding，按 5 个可独立交付的阶段实施
>
> 原则：**每个阶段结束时，产品都处于可上线、可演示、有独立价值的状态。**

---

## 1. 产品定位

KodaX Fabric 是企业级 Token 统一接入管理和服务平台。企业的所有 LLM API 调用经过 Fabric 网关，由 Fabric 统一路由、限流、计量，并回答三个核心问题：

> **Token 花在哪里？花得值不值？怎么花得更值？**

| 角色 | 痛点 | Fabric 提供的价值 |
|---|---|---|
| 管理者 / CIO | 看不清 Token 花在哪、哪些是浪费 | Token ROI 仪表盘：每个团队/项目/模型的效能与浪费 |
| 平台团队 | 每个系统重复建 Key 管理/限流/重试 | 统一网关，一套配置管所有 Provider |
| 开发者 | 要管 Provider、Key、限流、Fallback | 只改 base_url 指向 Fabric，其余由 Fabric 处理 |

### 1.1 设计原则（不可动摇）

1. **零转换透传**：OpenAI 端点只路由 OpenAI 系 Provider，Anthropic 端点只路由 Anthropic 系，不做跨协议转换——无转换即无语义丢失（thinking 块、cache_control、tool_choice 全保留）
2. **不调用 LLM**：所有优化用统计方法，安全/合规/预算硬规则由代码执行
3. **凭据不下发**：调用方持 Virtual Key，Provider Key 加密存储、永不外泄
4. **账本 append-only**：不修改历史流水，差额用 Adjustment 追加
5. **决策可审计**：每次路由选择记录"选了谁、为什么"

### 1.2 竞品与差异化

LiteLLM、One API 等开源网关解决了"接入管理"（路由、限流、Key 管理）。Fabric 在此之上做 **Token ROI 层**：Token 分类计量、文件级成本归因、浪费检测、ROI 优化路由——这是竞品没有的护城河。

---

## 2. 分步路线总览

> 预估按"单人 + AI coding"模式给出：编码不是瓶颈，瓶颈是验证正确性和真实流量磨合，预估中已包含验证时间。

```text
Phase 1  最小网关（1-1.5 周）      ── 能用：透传 + VK + 计量 + 成本
Phase 2  治理层（1.5-2 周）        ── 可控：渠道池 + 限流 + 熔断 + 预算
Phase 3  Token ROI（2.5-3.5 周）   ── 差异化：分类 + 文件归因 + 浪费检测
Phase 4  Commerce（2 周，可选）    ── 变现：Credits + 套餐 + 账单
Phase 5  智能优化（持续）          ── 增强：ROI 路由 + Outcome ROI
```

依赖关系：Phase 2 依赖 1；Phase 3 依赖 1（不依赖 2）；Phase 4 依赖 1+2；Phase 5 依赖 3 的数据积累。单人开发无并行，推荐顺序 **1 → 2 → 3 → (4) → 5**；若想尽早演示护城河，可 1 → 3 → 2。

优先级判断标准：Phase 1-2 解决"省心"（对标 LiteLLM/One API，是入场券）；Phase 3 是护城河；Phase 4 只在确定对外卖 Token 时启动。

---

## 3. Phase 1：最小网关（MVP）

**目标**：一个企业能把真实流量切过来，并第一次看清"每个项目每天花了多少钱"。

### 3.1 范围

| 模块 | 内容 |
|---|---|
| 双端点透传 | `POST /v1/chat/completions`（OpenAI 系）、`POST /v1/messages`（Anthropic 系）。纯透传：仅解析 `model`、`stream` 和响应 `usage`，不改请求/响应体 |
| SSE 流式 | 逐 chunk 转发不缓冲；流结束后从最后 chunk 取 usage 计量；客户端断开则 cancel 上游 |
| Virtual Key | VK 创建/停用（管理台手动，无审批流）；VK → Project 绑定；VK 哈希存储，明文仅创建时返回一次 |
| Provider Key | AES-256-GCM 加密存储；每个模型先支持**单渠道**（一个 Provider + 一个 Key），多渠道留给 Phase 2 |
| 基础计量 | 每次请求记录：VK、项目、模型、input/output/cached tokens、延迟、状态码。异步写入，不阻塞响应 |
| 成本计算 | 单套价格表（成本价），每模型一行（输入/输出/缓存单价）。请求完成后算成本入账 |
| Run 关联 | `x-fabric-context` 头支持 `{project_id, task_type, run_id}`；无 run_id 时按 VK + 30 分钟滑动窗口推断聚合，标记 `run_source: inferred` |
| 管理台（最小） | 本地账号登录（bcrypt）；页面仅 4 个：Provider/Key 管理、VK 管理、价格表、用量报表（按项目/模型/日聚合） |

### 3.2 技术形态

- 单进程 Go 二进制（Gateway + 计量 worker + Admin API 同进程，goroutine 隔离）
- 存储：PostgreSQL（配置 + 计量流水）；Redis 本阶段可不部署
- 部署：Docker Compose 一条命令拉起；前端 React 静态托管

### 3.3 不做

跨协议转换、多渠道负载均衡、限流、熔断、预算控制、Token 分类、审批流、多租户、ClickHouse、K8s。

### 3.4 验收标准

1. 现有 OpenAI SDK / Anthropic SDK 应用只改 `base_url` + `api_key` 两行即可接入，流式/非流式行为与直连完全一致
2. 网关自身开销 P99 < 50ms（不含 Provider 响应）
3. 计量 Token 数与 Provider usage 一致（直接取 usage，误差为 0）；成本按价格表可复算
4. Provider Key 在数据库、日志、API 响应中均不出现明文
5. 用量报表能按 项目 × 模型 × 天 三维查询

---

## 4. Phase 2：治理层

**目标**：从"能用"到"可控"——多渠道高可用 + 限流 + 预算硬约束，达到对标 LiteLLM/One API 的完整度。

### 4.1 范围

| 模块 | 内容 |
|---|---|
| 渠道池化 | 渠道 = Provider + Key + 模型 + 权重 + 优先级；同优先级加权随机，高优先级全挂后切低优先级 |
| 重试与 Fallback | per-channel 重试（默认 2 次，仅 429/5xx，指数退避），同模型换渠道；模型 Fallback 仅同协议内（gpt-4 → gpt-4o） |
| 渠道健康与熔断 | 滑动窗口成功率（最近 100 次），< 80% 自动禁用；禁用后每 30s 探测，成功恢复。熔断参数全局统一 |
| 限流 | 四维令牌桶（per-key / per-project / per-team / per-provider），Redis Lua 原子操作；策略先只做**硬拒绝 429**，排队/降级推迟 |
| 预算 | 三级 Budget Waterfall（项目 → 团队 → 企业）；软限制 80% 告警（响应头 + Webhook），硬限制 100% 拒绝（402）。采用"事后扣减 + 阈值检查"，预算预占留给 Phase 4（预占服务于对外计费的精确性） |
| 组织结构 | Organization → Team → Project → VK 四级；角色：企业管理员 / 团队管理员 / 开发者（超管角色留给 SaaS 场景） |
| VK 审批流 | 开发者自服务申请 → 团队管理员审批 → 生成 VK；项目名创建后不可改（成本归因和预算绑定的主键） |
| 审计日志 | 路由决策、熔断、限流触发、预算拦截、Key 操作 |

### 4.2 Redis 成为必选

限流计数器、预算余额、渠道健康状态入 Redis；Redis 故障时降级为本地宽松限流 + 告警，预算检查降级为只读放行（可配置 Fail Closed）。

### 4.3 验收标准

1. 单渠道人为下线后，流量在 5s 内自动转移，客户端无感知（除延迟波动）
2. 限流：超过 RPM 的请求稳定返回 429，不误伤限内请求（±5% 容差）
3. 预算：达到硬限制后新请求 402；跨天/跨月预算窗口正确重置
4. 每次请求的路由决策可在审计日志中查到"候选渠道、选中原因、是否重试/Fallback"

---

## 5. Phase 3：Token ROI（护城河）

**目标**：交付竞品没有的能力——回答"Token 花得高不高效、浪费在哪个文件"。

### 5.1 Token 三分类

| 分类 | 包含类型（权重） | 在指标中的角色 |
|---|---|---|
| **核心价值** | User Query (1.0)、Final Output (1.0)、Structured (0.6)、Context (0.5)、Tool Call (0.5)、Injected (0.4) | 计入"有价值成本" |
| **必要开销** | System Prompt (0.3)、Thinking (0.3) | 单独展示占比，不算浪费也不算有价值 |
| **低价值** | Tool Result (0.2) | 计入低价值占比 |

```text
Token ROI      = 核心价值成本 / 总成本
必要开销占比    = 必要开销成本 / 总成本
浪费成本       = 浪费检测（5.3）识别的客观浪费，与权重无关
```

> 权重为经验默认值，**企业可配置**；缓存命中 cache_factor = 0.1（按 Provider 实际折扣可配）。
> 输入分类用 tokenizer 估算后**按比例归一化**，保证分类之和 = Provider usage 总数。

### 5.2 文件级成本归因

解析响应中的标准 tool_calls（OpenAI function_call / Anthropic tool_use），提取文件路径，按 `该 tool_call 输出 token / 总输出 token` 分摊请求成本。UI 区分"直接输出成本"与"分摊的输入成本"。同一 Run 内同一文件多次 edit 标记为重试。

> 仅支持 OpenAI/Anthropic 标准工具调用格式；纯文本输出（无工具调用）的文件映射由 Phase 5 的 Runtime 报告 API 补充。工具调用结构是元数据，在所有数据保存模式下可解析。

### 5.3 浪费检测（基于客观信号，对外主打）

| 指标 | 检测方法（精确匹配 + 启发式，不调用 LLM） |
|---|---|
| Retry Amplification | Run 内同一文件多次 edit |
| Loop Factor | 相同 messages hash 重复请求 |
| Unproductive Spend | 失败（5xx）/ 取消请求的成本 |
| Cache Miss Rate | 未命中缓存 / 缓存候选 |

> 上下文冗余（语义近似检测）留给 Phase 5 评估。

### 5.4 分析存储与界面

- 计量流水从 PostgreSQL 迁移/双写到 **ClickHouse**（本阶段引入，按月分区，按项目 TTL）
- 新增界面：ROI 仪表盘（趋势/浪费分解/模型对比）、用量分析（成本瀑布下钻 + Token 分类 + 文件归因）、Run Explorer（单请求全链路：路由 → 调用 → 分类 → 归因 → ROI）
- 数据保存策略：先做 **Metadata Only / Full 两档** + TTL，完整五档（Redacted/Zero/Local Only + Legal Hold）留到有合规客户需求时

### 5.5 验收标准

1. 任一请求在 Run Explorer 中可看到完整链路和 Token 分类明细，分类之和等于 usage 总数
2. 文件归因：对使用标准工具调用的 Agent 流量，≥ 90% 的输出成本可归因到文件或"推理/分析"
3. 浪费检测：人为构造重试/重复/失败场景，检出率 100%，无误报正常流量
4. 仪表盘聚合查询（30 天 × 全项目）P95 < 2s

---

## 6. Phase 4：Commerce（可选，确定卖 Token 再启动）

**目标**：支持对外卖 Token（SaaS）或内部成本核算（单一企业 + 外部 API）。

### 6.1 范围

| 模块 | 内容 |
|---|---|
| Pricebook 双套价格 | 标准价（对客）+ 成本价（内部），版本化；**计价一致性约束**：标准价 = 倍率 × Credit 单价，自动派生防套利 |
| AI Credit | Credits = Σ(tokens × 倍率 × cache_factor)；倍率表版本化，套餐锁定购买时版本 |
| 套餐与三层计量 | 订阅额度内 → 超额区（标准价 × markup）→ 透传区（标准价现金）；透传区硬上限 = 月套餐费 3 倍，触发熔断防止无限负债 |
| 预算预占 | 两阶段：P90 初始预占 + 增量追加；Run 结束释放 |
| 账单 | 月度账单生成、退费/冲正（5xx 退 Credits）、利润分解（超卖/超额/透传/缓存）、供应商对账 + Adjustment |
| 多租户 | Tenant 层级 + 超管角色（仅 SaaS）；逻辑隔离（tenant_id 过滤） |
| OIDC | 管理台对接企业 SSO（可选配置） |

### 6.2 计费口径

- 响应缓存命中（Fabric 层缓存）：不扣 Credits、不计 Provider 成本，账单标注"缓存响应"
- Anthropic 缓存写入（cache_creation）按 Provider 实际计费单独入成本账，cache_factor 不覆盖它

### 6.3 验收标准

1. 端到端：客户购买套餐 → 用量跨越三层 → 月底账单金额可人工复算，误差为 0
2. 与 Provider 月账单对账差异 < 1%，差额全部有 Adjustment 记录
3. 修改倍率或 Credit 单价后标准价自动更新，一致性校验无红项

---

## 7. Phase 5：智能优化（持续迭代）

**目标**：用积累的数据反哺路由决策，并接入 KodaX 体系激活 Outcome ROI。

### 7.1 范围

| 模块 | 内容 |
|---|---|
| ROI 优化路由 | bandit：按 模型 × task_type 定时聚合历史 ROI × 成功率，路由时查表推荐；样本 < 1000 回退简单路由；所有推荐记录理由 |
| 路由优化建议 | 仪表盘展示"coding 任务用 A 比 B 的 ROI 高 30%，预计月省 ¥X"，一键应用 |
| Runtime 报告 API | `POST /api/v1/reports/outcomes`（Outcome Evidence：L0-L3 分级）、`POST /api/v1/reports/file-mappings`（纯文本输出的文件映射）、`POST /api/v1/reports/usages`（非 LLM 资源用量归因） |
| Outcome ROI | OutcomeValue（L0=1× / L1=3× / L2=8× / L3=20×，可配）/ 总成本；仅在收到 Runtime 报告时激活 |
| 语义级浪费检测 | 评估 MinHash/LSH 做近似重复检测（仍不调用 LLM） |

### 7.2 验收标准

1. ROI 路由推荐与人工基于同样数据的判断一致；样本不足时稳定回退，无错误推荐
2. Outcome 报告注入后，Run Explorer 与 ROI 仪表盘自动出现 Outcome ROI 视图
3. 关闭 ROI 优化开关后系统行为与 Phase 2 简单路由完全一致（可随时回退）

---

## 8. 节奏与交付物（单人 + AI 模式）

### 8.1 预估的依据

单人 + AI 模式下，工期不由"代码量 ÷ 人数"决定。真正花时间的是三类无法靠 AI 生成速度压缩的工作，预估围绕它们给出：

1. **正确性验证**：透传语义（各 Provider 的 SSE/usage 格式差异、流式中断、工具调用边界）、限流原子性、账能不能对上——必须写测试、跑真实流量
2. **设计决策**：分类归一化规则、Run 推断窗口、预算降级策略等，AI 能给方案但要人拍板
3. **磨合期**：切真实流量后暴露的边界情况（这是日历时间，不是工作量）

### 8.2 节奏表

| 阶段 | 预估 | 其中验证占比 | 交付物 | 上线条件 |
| --- | --- | --- | --- | --- |
| Phase 1 | 1-1.5 周 | ~一半（透传一致性 + SSE 边界） | 可部署的网关 + 4 页管理台 | 自己的真实项目切流量试用 |
| Phase 2 | 1.5-2 周 | ~一半（故障注入 + 限流/预算准确性） | 高可用 + 限流 + 预算 + 审批流 | 可替代 LiteLLM/One API |
| Phase 3 | 2.5-3.5 周 | ~1/3（分类对账 + 归因准确率），界面占大头 | ROI 三件套 + ClickHouse | 对外演示护城河能力 |
| Phase 4 | 2 周（按需启动） | ~一半（账单复算 + 对账，钱的正确性不能省） | Commerce 全套 | 首个付费客户签约前完成 |
| Phase 5 | 持续 | — | 智能路由 + Outcome 集成 | Phase 3 数据积累 ≥ 1 个月后 |

累计：**前三阶段 5-7 周可上线**，加 Commerce 约 7-9 周。磨合期与下一阶段开发重叠，不单独占工期。

### 8.3 单人 + AI 模式的工程约束（为可维护性服务）

维护升级也是一个人，以下不是可选项：

1. **回归测试是安全网**：AI 大范围改代码的前提是完整的 e2e 测试套件。Phase 1 起就建立"录制的 Provider fixture + 契约测试"，每个 Provider 的真实响应（含流式 chunk 序列）录下来做回放测试
2. **管理台不做定制设计**：用现成组件库（如 Ant Design）+ 生成式 CRUD，界面工期主要留给 Phase 3 的三个分析页面
3. **单进程 + Compose 贯穿始终**：一个人运维不起微服务，出现真实负载瓶颈前永不拆分
4. **每阶段结束打 tag 并可一键回滚**：没有同事帮你救火

---

## 9. 全程不做（产品边界）

1. 不做跨协议转换（GPT ↔ Claude）
2. 不在 Fabric 层调用 LLM
3. 不做统一物理 Token 换算（不同模型 Token 不等价，经济单位用货币/Credit）
4. 不替代 K8s / GPU 调度器，不实现 Agent Runtime
5. 不计算自建资源完全成本（归企业 FinOps）
6. 不把路由做成不可解释黑盒
7. 不要求企业应用重写（兼容 OpenAI/Anthropic SDK）
8. 不引入 Kafka、K8s、微服务拆分——单进程 + Compose 贯穿始终，出现真实负载瓶颈前永不拆分（单人维护的硬约束）
