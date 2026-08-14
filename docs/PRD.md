# KodaX Fabric — 产品需求文档（PRD）

> **工作名称**：KodaX Fabric
> **产品类别**：企业级 Token 统一接入管理和服务平台
> **定位**：Token Hub + Token 效能管理
>
> **现行 Token Hub（v0.1.3）**：操作员 `role` 只有三值 `org_admin` / `team_admin` / `developer`（遗留 `admin` 读作 `org_admin`）。无超管、无多租户。下文 §10 的四角色与 17 个大屏是整机愿景，不是现网菜单。

---

## 1. 产品定位

### 1.1 一句话定义

KodaX Fabric 是企业级 Token 统一接入管理和服务平台——**统一接入所有 LLM API，衡量 Token ROI**。

### 1.2 核心问题

> 企业的 Token 花在哪里？花得值不值？怎么花得更值？

| 问题 | Fabric 怎么回答 |
|---|---|
| 花了多少 Token？什么类型？ | 接入管理：统一网关，分类计量 |
| 花在了什么任务上？什么文件上？ | 成本归因：文件级 Token 成本追踪 |
| Token 花得高效吗？多少是浪费？ | Token ROI：加权成本效率 + 浪费检测 |
| Token 产出了什么业务价值？ | Outcome ROI（需 KodaX Agent 体系）：产出价值衡量 |
| 不同模型、不同策略的 ROI 对比如何？ | ROI 分析：模型间/团队间/时间间对比 |

### 1.3 使命

> 让每一个 Token 都花在有价值的地方。

### 1.4 产品边界——不做的事

| # | 不做 | 原因 |
|---|---|---|
| 1 | 不把所有模型 Token 强行换算成一种物理 Token | 不同模型 Token 不等价 |
| 2 | 不替代 Kubernetes 或 GPU Pod Scheduler | 不重复造轮子 |
| 3 | 不重新实现 Agent Runtime | Runtime 是执行层，Fabric 是接入和计量层 |
| 4 | 保存行为由策略驱动 | 支持五档模式 + TTL + 归档分级 + 自动清理 + Legal Hold |
| 5 | 不让 LLM 决定安全/合规/预算硬规则 | 确定性优先，硬规则由代码执行 |
| 6 | 不在 Fabric 层随意调用 LLM | 避免预算外 Token 成本；优化用统计方法 |
| 7 | 不只看调用价格而忽略 Token 效能 | ROI 导向，不是最低价导向 |
| 8 | 不把路由做成不可解释的黑盒 | 可审计 |
| 9 | 不要求所有企业应用一次性重写 | 兼容 API（OpenAI/Anthropic） |

> **所有进入 Fabric 的资源都可以被池化。** 个人订阅不会进入 Fabric 网关——只有企业拥有的、可共享的模型接入资源才会接入。

### 1.5 目标用户与价值主张

| 角色 | 痛点 | Fabric 提供的价值 |
|---|---|---|
| **管理者 / CIO** | 看不清 Token 花在哪、不知道哪些是浪费 | Token ROI 管理：每个团队/项目/模型的 Token 效能、浪费比例 |
| **平台团队** | 每个业务系统重复建 Provider SDK / Key / 限流 / 重试 | 统一网关，一套 API Key 管所有 Provider，自动限流和故障转移 |
| **开发者** | 要管 Provider、Key、限流、Fallback | 只改 base_url 指向 Fabric，其余由 Fabric 处理 |
| **普通用户** | 不懂模型、不懂预算 | 在 KodaX Space 中输入任务，Fabric 在后台路由和计量 |
| **平台运营人员** | 需要对外卖 Token、管理套餐和利润 | 启用 Fabric Commerce 模块：套餐、AI Credit、三层计量、客户账单 |

> **Fabric Core vs 定价与计费**：Fabric Core（Token Hub + Token ROI + 计量 + 治理）是所有部署的基础。定价与计费界面（Pricebook/套餐/账单）在使用外部 API 时启用——SaaS 模式为商业计费（对外卖 Token，含 Credits/split/markup/利润追踪），单一企业模式为内部成本核算（标准价=团队收费价，成本价=API 成本，无三层利润分解）。仅使用自建模型时不启用。

---

## 2. Token ROI 体系

> Token ROI 是 Fabric 的核心价值。不是"花了多少钱"，而是"花的 Token 值不值"。

### 2.1 两层 ROI 分离

Fabric 将 ROI 分为两层，独立计算，独立展示：

```text
┌─────────────────────────────────────────────────┐
│  Token ROI（Fabric 独立完成）                     │
│  衡量：Token 花费效率                              │
│  "花在输入/输出/重试上的 Token 是否高效？"          │
│  依赖：仅 Fabric 网关自身                          │
│  可用：始终可用，只要流量经过 Fabric                │
└──────────────────────┬──────────────────────────┘
                       │ 独立
┌──────────────────────▼──────────────────────────┐
│  Outcome ROI（KodaX 体系协作）                    │
│  衡量：Token 产出价值                              │
│  "这些 Token 产出了什么业务价值？"                  │
│  依赖：Runtime/Space 报告 Outcome Evidence         │
│  可用：企业部署 KodaX Agent 体系时自动激活          │
└─────────────────────────────────────────────────┘
```

| 层 | 问题 | 公式 | 依赖 | 可用条件 |
|---|---|---|---|---|
| **Token ROI** | Token 花得高效吗？ | WeightedTokenEfficiency = 有价值 Token 成本 / 总 Token 成本 | Fabric 独立 | 始终可用 |
| **Outcome ROI** | Token 花得值吗？ | OutcomeValue / WeightedTokenCost | Runtime 报告 Outcome | 部署 KodaX Agent 体系时 |

> 两层分离的设计使得：① Fabric 不部署 KodaX Agent 体系时仍有 Token ROI；② 企业同时部署 KodaX Agent 体系时自动获得 Outcome ROI 增强。

### 2.2 Token 分类体系

**输入 Token：**

| 类型 | 价值权重 | 缓存潜力 | 说明 |
|---|---|---|---|
| 系统提示 (System Prompt) | 0.3 | 高（可缓存） | 固定开销，每次重复 |
| 用户查询 (User Query) | 1.0 | 低 | 核心价值，不可省 |
| 上下文/历史 (Context) | 0.5 | 中 | 边际价值递减 |
| 工具调用结果 (Tool Result) | 0.2 | 低 | 取决于是否被引用 |
| 文件/仓库内容 (Injected) | 0.4 | 中 | 取决于相关性 |

**输出 Token：**

| 类型 | 价值权重 | 说明 |
|---|---|---|
| 正式输出 (Final Output) | 1.0 | 核心产出 |
| 工具调用 (Tool Call) | 0.5 | 手段性产出 |
| 思维链 (Thinking) | 0.3 | 开销性产出 |
| 结构化数据 (Structured) | 0.6 | 取决于消费方 |

**缓存因子：** 命中缓存 = 0.1×，未命中 = 1.0×

### 2.3 Token ROI 公式

```
TokenROI = 有价值 Token 成本 / 总 Token 成本

有价值 Token 成本 = Σ(input_count × type_weight × cache_factor × unit_price)
                   （type_weight ≥ 0.3 的 Token 视为有价值；System Prompt 和 Thinking 属必要低价值开销，不计为浪费但计入低价值比例）

总 Token 成本 = Σ(所有 input_count × type_weight × cache_factor × unit_price)
             + Σ(所有 output_count × type_weight × unit_price)

浪费成本 = 总 Token 成本 - 有价值 Token 成本
```

**Outcome ROI（当 Runtime 报告 Outcome 时）：**

```
OutcomeROI = OutcomeValue / 总 Token 成本

OutcomeValue（由 Runtime/Space 报告）：
  L0 Delivery（模型正常返回）= 1×
  L1 Verification（通过机器验证，如测试通过）= 3×
  L2 Acceptance（被用户采纳，如代码被采用）= 8×
  L3 Business Impact（产生业务结果，如 PR 合并）= 20×
  被拒绝 = 0×
  倍率为经验值，可按企业场景调整
```

### 2.4 文件级成本归因

> Fabric 解析 LLM 工具调用输出（edit/write/read），工具调用参数中包含文件路径。按文件归因 Token 成本，检测同一文件的多次编辑（重试）。

```text
Run：修复支付服务 CI    总成本：¥6.73

src/auth/login.py     ¥2.40 (35.7%)  — 3 次 edit（2 次重试），最终成功
src/auth/utils.py     ¥1.80 (26.8%)  — 1 次 edit，成功
tests/test_login.py   ¥1.53 (22.7%)  — 1 次 write，成功
（推理/分析）          ¥1.00 (14.8%)  — 读文件后的分析，未产生修改
```

> **限制**：仅支持 OpenAI/Anthropic 标准工具调用格式（function_call / tool_use）。纯文本输出（无工具调用）需 Runtime 报告文件映射。各 Agent 框架自定义工具 schema 不在 V1 支持范围内。工具调用结构是元数据，在所有数据模式下可解析。

### 2.5 Token 浪费检测

| 指标 | 定义 | 说明 |
|---|---|---|
| Retry Amplification | 实际模型调用次数 / 成功逻辑步骤数 | 重试放大的 Token 消耗 |
| Loop Factor | 重复或近似步骤数 / 全部步骤数 | 循环浪费 |
| Context Redundancy | 重复上下文 / 输入 Token | 上下文膨胀 |
| Unproductive Spend | 失败/取消/未验证结果的成本 | 无效花费 |
| Cache Miss Rate | 未命中缓存 / 总缓存候选 | 缓存利用不足 |

> 浪费检测是 Token ROI 的核心组成——浪费 = 低 ROI。所有指标基于 Fabric 网关自身数据，不依赖 Runtime。
>
> **方法说明**：V1 使用精确匹配 + 启发式规则（如相同文件路径多次 edit = 重试，相同 messages hash = 重复请求）。「近似」重复检测（语义相似度）需要 embedding，V1 不做，V2 评估引入 MinHash/局部敏感哈希。不调用 LLM。

### 2.6 ROI 监控与对比分析

| 功能 | 说明 |
|---|---|
| 实时 ROI 仪表盘 | 当前小时/天的 Token ROI、浪费比例、成本趋势 |
| 模型间 ROI 对比 | 同一任务类型下，模型 A vs 模型 B 的 ROI、成本、成功率 |
| 团队间 ROI 对比 | 不同团队/项目的 Token 效能对比 |
| 时间趋势 | 本周 vs 上周、本月 vs 上月的 ROI 变化 |
| ROI 告警 | ROI 低于阈值、浪费比例高于阈值时通知 |
| 路由优化建议 | "这类任务用模型 A 的 ROI 比模型 B 高 30%" |

---

## 3. Token Hub 接入管理

> Token Hub 是 Fabric 的接入核心。所有 LLM API 调用经过 Fabric，由 Fabric 统一路由、限流、计量。

### 3.1 协议适配

| 协议 | 方向 | 说明 |
|---|---|---|
| OpenAI Compatible | 入 + 出 | 客户端用 OpenAI SDK 指向 Fabric；Fabric 转发到 OpenAI/Azure/兼容 Provider |
| Anthropic Compatible | 入 + 出 | 客户端用 Anthropic SDK 指向 Fabric；Fabric 转发到 Anthropic |
| vLLM / 自建推理 | 出 | Fabric 适配自建 vLLM 集群的 API |
| Fabric Native API | 入 | 通过 `x-fabric-context` 请求头在任何端点上传递上下文，无需单独端点 |

**双端点，零转换：**

| 端点 | 协议 | 路由到 | 转换 |
|---|---|---|---|
| `/v1/chat/completions` | OpenAI | OpenAI / Azure OpenAI / vLLM / 其他 OpenAI 兼容 Provider | **零转换，纯透传** |
| `/v1/messages` | Anthropic | Anthropic / AWS Bedrock Claude | **零转换，纯透传** |

**设计原则：不转换。**

Fabric 不做跨协议转换。OpenAI 格式的请求只路由到 OpenAI 兼容的 Provider，Anthropic 格式的请求只路由到 Anthropic 兼容的 Provider。每个端点都是纯透传——客户端发什么，Provider 收什么；Provider 返回什么，客户端收什么。

**为什么不转换：**
- 更简单：无转换逻辑 = 更少 bug
- 更稳定：无转换 = 无数据丢失（thinking 块、cache_control、tool_choice 语义全保留）
- 更可靠：纯透传永远比转换可靠
- 更可维护：Provider API 变了不需要更新转换逻辑

**客户使用方式：**
- 只用 OpenAI 模型：只配 OpenAI 端点
- 只用 Claude：只配 Anthropic 端点
- 两个都用：配两个端点，选模型时选对应端点

> 同一个 Fabric API Key，两个端点都能用。`fabric_context` 通过 `x-fabric-context` 请求头传递，两个端点都支持。客户不需要“选择”——他们已经知道要用哪个模型，GPT-4 走 OpenAI 端点，Claude 走 Anthropic 端点，这是“对应”不是“选择”。

**限制：**
- 不支持跨协议 Fallback（GPT-4 → Claude）。Fallback 只在同一协议内（GPT-4 → GPT-4o → GPT-3.5，或 Claude Sonnet → Claude Haiku）
- ROI 优化路由（3.5）在同一协议内推荐最优模型
- 如需跨协议能力，V2 评估可选转换层

> **Fabric 只适配 LLM API 协议。** MCP 工具、A2A Agent、搜索 API、Sandbox 等非 LLM 资源由 Runtime 执行和适配；Runtime 调用后向 Fabric 报告用量，Fabric 负责成本归因。
>
> **其他 API 支持**：除 chat completions 外，Fabric V2 支持 Embedding API 路由（`/v1/embeddings`）和 Batch API 路由。多模态（图片/音频/视频）计价在 Pricebook 中按 Provider 原始单位定义。Provider 限流头（`x-ratelimit-remaining` 等）透传给客户端。

### 3.2 API Key 生命周期管理

| 功能 | 说明 |
|---|---|
| Key 注册 | 每个 Provider 的 API Key 录入（加密存储） |
| Key 轮换 | 自动轮换（配置周期）+ 手动轮换；轮换期间不中断服务 |
| Key 健康监控 | Key 失效检测（401/403 告警）、配额耗尽检测 |
| Key 权限范围 | 每个 Key 绑定可用模型列表和限流配额 |
| 多 Key 负载均衡 | 同一 Provider 多个 Key 轮转使用，分摊限流 |
| Key 隔离 | 不同团队的流量使用不同 Key，互不影响 |

**Virtual Key（虚拟密钥）：**

Virtual Key 是发放给调用方的密钥，与 Provider Key 分离。调用方用 Virtual Key 访问 Fabric，Fabric 内部用 Provider Key 访问上游。

| 配置项 | 说明 |
|---|---|
| 预算上限 | ¥/月，超出触发软/硬限制 |
| 限流配额 | RPM/TPM，独立于团队级限流 |
| 可用模型 | 该 Key 能调用哪些模型 |
| 渠道池映射 | 该 Key 使用哪个渠道池（见 3.3） |
| 过期时间 | 到期自动失效 |
| IP 白名单 | 可选，限制调用来源 |

```text
Virtual Key → Project → Team → 渠道池 → Provider Key

调用方持有 Virtual Key（fab-xxxx）
Fabric 内部映射到 Provider Key（sk-xxxx）
调用方永远看不到 Provider Key
```

### 3.3 渠道池化

**渠道（Channel）** = Provider + API Key + 模型列表 + 权重 + 优先级

一个渠道代表一条可用的 API 调用路径。同一模型可有多个渠道：

```text
模型 "gpt-4" 的渠道池：
  ├── 渠道 1：Azure East + key-001 + 权重 60 + 优先级 1
  ├── 渠道 2：Azure West + key-002 + 权重 40 + 优先级 1
  └── 渠道 3：OpenAI 直连 + key-003 + 权重 100 + 优先级 2（备选）
```

**渠道分组：**

| 分组 | 用途 | 示例 |
|---|---|---|
| premium | 高优先级、低延迟 | Azure 直连 |
| standard | 标准渠道 | OpenAI 直连 |
| bulk | 低成本 | 第三方代理 |

项目/团队 → 渠道分组映射：VIP 项目用 premium，普通项目用 standard，批处理用 bulk。

**渠道健康监控：**

| 机制 | 说明 |
|---|---|
| 滑动窗口成功率 | 每个渠道维护最近 N 次请求的成功率 |
| 自动禁用 | 成功率 < 阈值（默认 80%）→ 自动禁用该渠道 |
| 自动恢复 | 禁用后定期探测，成功则恢复 |
| 流量转移 | 渠道禁用后，流量自动转移到同池其他渠道 |

**池级容量：**

| 维度 | 说明 |
|---|---|
| 聚合 RPM | 池内所有健康渠道的 RPM 之和 |
| 聚合 TPM | 池内所有健康渠道的 TPM 之和 |
| 可用渠道数 | 健康渠道数 / 总渠道数 |
| 池级限流 | 可对整个池设置 RPM/TPM 上限 |

### 3.4 路由和负载均衡

**模型别名映射：**

```json
{
  "gpt-4": {
    "providers": [
      { "provider": "azure-east", "weight": 60, "priority": 1 },
      { "provider": "azure-west", "weight": 40, "priority": 1 },
      { "provider": "openai-direct", "weight": 100, "priority": 2 }
    ],
    "fallback": "gpt-4o"
  }
}
```

**路由策略：**

| 策略 | 说明 |
|---|---|
| 加权轮转 | 同优先级 Provider 按权重分配流量 |
| 优先级故障转移 | 优先级 1 全部不可用 → 切到优先级 2 |
| 模型 Fallback | 主模型不可用 → 切到配置的 Fallback 模型（仅同协议内，如 GPT-4 → GPT-4o；不跨协议） |
| 延迟优先 | 优先选择历史 P99 延迟最低的 Provider |
| 成本优先 | 优先选择单位成本最低的 Provider（需配合 ROI 下限约束，避免最低价但低效） |

**路由决策记录：** 每次路由决策记录：选了哪个 Provider、为什么选、是否有 Fallback。可审计。

**重试策略：** per-channel 可配重试次数（默认 2）、退避策略（指数退避）、按状态码重试（429/5xx 重试，4xx 不重试）。重试不跨模型（同模型换 Provider），模型 Fallback 是独立机制（不同模型间切换）。

### 3.5 ROI 优化路由（混合模式）

> 默认简单路由，可选开启 ROI 优化模式。ROI 优化基于统计历史，**不调用 LLM**。

**默认模式（简单路由）：**
- 开发者指定模型（如 `gpt-4`），Fabric 路由到最佳 Provider
- 自动故障转移
- 适合 V1，无需历史数据

**可选模式（ROI 优化路由）：**
- 开发者指定任务类型（如 `coding`），Fabric 基于历史 ROI 推荐最优模型
- 需要积累足够历史数据（最少 N 次同类任务）

**工作原理：**

```text
1. 数据采集（每次调用）
   模型 + Provider + 任务类型 + Token 用量（分类）+ 成本 + 延迟 + 成功率
                                    ↓
2. 历史聚合（离线/定时）
   按 模型 × 任务类型 聚合，计算每个组合的平均 Token ROI
                                    ↓
3. 路由推荐（实时）
   新请求 → 查同类任务历史 → 推荐 ROI 最高的模型
   历史数据不足 → 回退到简单路由
```

**算法（纯统计，不调用 LLM）：**

```
对每个候选模型 M：
  ExpectedROI(M) = HistoricalTokenROI(M, task_type) × SuccessRate(M, task_type)

推荐：argmax(ExpectedROI(M))

安全约束：
  - 只推荐调用者有权使用的模型
  - 只推荐满足任务最低要求的模型（如上下文长度）
  - 历史样本数 < N → 回退简单路由
  - 所有决策记录理由（可审计）
```

> 本质是 bandit 算法：用不同模型处理同类任务，统计学习哪个 ROI 最高。不需要 LLM 推理，不需要实时计算——定时聚合历史数据，路由时查表即可。

### 3.6 限流策略

| 维度 | 说明 |
|---|---|
| per-provider | 每个 Provider 的 RPM/TPM 限制（来自 Provider 合同） |
| per-team | 每个团队的 RPM/TPM/并发限制 |
| per-project | 每个项目的限制 |
| per-api-key | 每个 API Key 的限制 |

| 策略 | 说明 |
|---|---|
| 硬拒绝 | 超限直接返回 429 |
| 排队 | 超限进入队列，等待可用 |
| 降级 | 超限切到更便宜的替代模型 |
| 突发容忍 | 令牌桶/漏桶，允许短时突发 |

### 3.7 熔断和健康检查

| 机制 | 说明 |
|---|---|
| 主动探测 | 定期向 Provider 发送轻量请求，检测可用性 |
| 被动检测 | 基于实际请求的错误率和延迟自动评估 |
| 熔断触发 | 错误率 > 阈值 或 P99 延迟 > 阈值 → 熔断 |
| 熔断动作 | 标记 Provider 不可用，流量自动切到同优先级其他 Provider |
| 恢复探测 | 熔断后进入半开状态，放少量流量探测，成功则恢复 |

### 3.8 缓存策略

| 类型 | 说明 |
|---|---|
| Prompt Cache | 利用 Provider 的 prompt caching（如 Anthropic prompt cache），减少重复输入 Token 成本 |
| 响应缓存 | 相同请求的缓存命中（适用于确定性任务），配置 TTL 和适用范围 |
| 缓存命中率监控 | 缓存命中节省了多少成本、命中率趋势 |

### 3.9 流式支持

| 功能 | 说明 |
|---|---|
| SSE 流式透传 | 透明转发 Provider 的 SSE 流，不缓冲不修改 |
| 实时 Token 估算 | 流式过程中用 tokenizer 估算已输出 Token 数，用于预算监控 |
| 流式中断处理 | 客户端断开 → 通知 Provider 停止；Provider 断开 → 通知客户端 |
| 最终计量 | 流式结束后用 Provider 返回的 usage 对象做精确计量；无 usage 时用估算值 |
| 流式缓存 | 流式响应不支持缓存（但 prompt 部分仍可缓存） |

---

## 4. 计量和计费

### 4.1 四套账本

| 账本 | 记录内容 |
|---|---|
| **用量账** | 输入/输出/Cached/Reasoning Token（分类）、图片音频视频单位、请求数 |
| **容量账** | RPM/TPM、并发、队列、可用余额、Provider 限流状态、到期时间 |
| **经济账** | 外部 API 成本、自建边际成本、预付消耗、内部成本单位、汇率、税费 |

> **命名说明**：4.1 中的「内部成本单位」用于内部核算；4.7 中的「AI Credit」是客户购买单位。两者含义不同，不可混用。多币种：Provider 账单多为 USD，Pricebook 可按 USD 或 CNY 配置，汇率按请求时点取值。
| **结果账** | 成功/失败/取消的请求数、浪费成本（重试/循环/无效）、缓存节省 |

> **自建资源成本**：Fabric 只计算边际成本（API 调用级别）用于计量。完全成本（含 GPU 租赁分摊、闲置分摊、运维）是企业 FinOps 工作，不属于 Fabric。

### 4.2 Budget Waterfall

```text
  项目专项预算
      │ 不足
      ▼
  团队预算
      │ 不足
      ▼
  企业公共预算
```

> 用户不需要指定从哪个账户扣款。系统根据项目绑定、成本中心、预算余额自动选择。V1 支持三级，数据模型预留 BU 层级供未来扩展。

### 4.3 预算控制（软限制 + 硬限制）

| | 软限制（Soft Limit） | 硬限制（Hard Limit） |
|---|---|---|
| 触发时机 | 预算使用达到 80% | 预算使用达到 100% |
| Fabric 动作 | 告警 + 降级建议（"建议切换到更便宜的模型"） | 拒绝请求（返回 402 Payment Required） |
| 通知方式 | 仪表盘 + Webhook + 邮件 | 仪表盘 + Webhook + 邮件 |
| 业务影响 | 不阻断，但有建议 | 阻断，需要审批提额或使用紧急额度 |

### 4.4 预算预占

```text
预计需要 ¥8 → 先预占 ¥10（历史 P90）
执行至 ¥7 时预测还需 ¥5 → 追加预占 ¥5
无法追加 → 软限制告警 / 硬限制拒绝
```

### 4.5 结算和对账

| 步骤 | 说明 |
|---|---|
| 释放预占 | Run 结束后释放未使用的预占额度 |
| 记录实际成本 | 按 Provider 实际计费规则记录 |
| 成本归因 | 归因到团队、项目、Run、文件 |
| Pricebook 版本 | 保留计费时的价格版本，支持历史回溯 |
| 供应商对账 | 周期性比对 Fabric 记录与供应商账单 |
| 差额调整 | 上游账单晚到时，通过 Adjustment 记录差额，不修改原流水 |

### 4.6 模型价格表（Pricebook）

> 4.1-4.5 是内部成本追踪；4.6-4.10 是**客户计费**——平台运营人员面向客户定义价格、套餐和账单。

Fabric 维护两套价格：**标准价**（面向客户）和**成本价**（内部核算）。两者之间的差额是利润空间。

| 价格类型 | 用途 | 来源 | 客户可见？ |
|---|---|---|---|
| **标准价** | 透传区向客户收费 | Provider 公开价或我们定义 | 可见（账单上显示） |
| **成本价** | 内部利润核算 | 预留容量分摊 / 按量付费 / 谈判折扣 | **不可见** |

**Pricebook 结构（每个模型一行）：**

| 字段 | 说明 | 示例 |
|---|---|---|
| model | 模型名 | gpt-4 |
| standard_input_price | 标准输入价（每 1K Token） | ¥0.03 |
| standard_output_price | 标准输出价（每 1K Token） | ¥0.06 |
| standard_cache_price | 标准缓存价（每 1K Token） | ¥0.003 |
| cost_input_price | 成本输入价（每 1K Token） | ¥0.015 |
| cost_output_price | 成本输出价（每 1K Token） | ¥0.03 |
| cost_cache_price | 成本缓存价（每 1K Token） | ¥0.0015 |
| context_window | 最大上下文 | 128000 |

**版本管理：** 价格变更时创建新版本。历史请求按当时版本计价，新请求按最新版本。套餐周期内锁定价格版本。

**计价一致性约束：** 标准价 = 倍率 × Credit 单价。例如 GPT-4 输入倍率 3.0，Credit 单价 ¥0.01/1K → 标准输入价必须 = ¥0.03/1K。修改倍率或 Credit 单价时，标准价自动派生，防止两处不一致导致客户套利或被多收。

### 4.7 AI Credit 体系

> 客户买的是 Credits，不是 Tokens。不同模型的 Token 按倍率换算为 Credits，解决混用计费问题。

**公式：**

```
AI Credits = Σ(input_tokens × input_multiplier × cache_factor)
           + Σ(output_tokens × output_multiplier)
```

**模型倍率表：**

| 模型 | 输入倍率 | 输出倍率 | 说明 |
|---|---|---|---|
| GPT-4o | 1.0 | 1.0 | 标准，1 Token = 1 Credit |
| GPT-4 | 3.0 | 6.0 | 输出比输入贵（与 Provider 定价一致） |
| Claude Sonnet | 1.5 | 3.0 | |
| Claude Haiku | 0.5 | 1.0 | |
| GPT-3.5 | 0.3 | 0.6 | |

**缓存因子：** 命中缓存 = 0.1×，未命中 = 1.0×

> 客户买"100 万 Credits"，无论用什么模型都按 Credits 扣减。GPT-4 用 10 万 Token 扣 30 万 Credits，GPT-4o 用 10 万 Token 扣 10 万 Credits。

**倍率表版本管理：** 倍率变更时新建版本。已有套餐锁定购买时的倍率版本，续费时切换到最新版本。

### 4.8 套餐管理

**套餐定义：**

| 字段 | 说明 | 示例 |
|---|---|---|
| name | 套餐名 | 企业标准版 |
| credit_quota | Credit 额度 | 1,000,000 Credits/月 |
| price | 套餐价格 | ¥10,000/月 |
| period | 周期 | monthly / yearly |
| split_ratio | 订阅/超额分割比 | 70（即 70% 订阅额度，30% 超额区） |
| overage_unit_price | 超额区单价（每 1K Credits） | ¥0.012（标准价 × 1.2 markup） |
| passthrough_price | 透传区单价（每 1K Credits） | ¥0.01（标准价，无 markup） |
| model_scope | 可用模型范围 | gpt-4, gpt-4o, claude-sonnet |
| pricebook_version | 锁定的价格表版本 | v2024.03 |

**客户层级：**

| 层级 | 特点 | 示例 |
|---|---|---|
| 企业 | 大额度、低 markup、自定义模型、年付 | 10M Credits/月，split=80，markup=1.1 |
| SMB | 标准额度、标准 markup、月付 | 1M Credits/月，split=70，markup=1.5 |
| 个人 | 小额度、高 markup、月付 | 100K Credits/月，split=50，markup=2.0 |

**生命周期：** 购买 → 使用 → 续费/升级/降级/过期。

### 4.9 三层计量

```text
套餐：100 万 Credits / ¥10,000 / 月    Split: 70/30

  0 ─────────── 70万 ─────────── 100万 ─────────── ∞
  │  订阅额度内   │   超额收费区    │   透传区       │
  │              │                │               │
  │  扣 Credits   │  扣 Credits    │  不扣 Credits  │
  │  不额外收费   │  + 收超额费     │  + 收透传费    │
  │              │  (标准价×markup) │  (标准价×Token)│
  └──────────────┴────────────────┴───────────────┘
  ← 套餐费已包含 → ← 客户额外付费 →
```

| 层 | 触发条件 | Credits 扣减 | 额外费用 | 利润来源 |
|---|---|---|---|---|
| **订阅额度内** | 0 ~ split% | 扣减 Credits | 无（套餐费已包含） | 客户未用完的部分 = 超卖利润 |
| **超额收费区** | split% ~ 100% | 扣减 Credits | 超额 Credits × 标准价 × markup | markup = 超额利润 |
| **透传区** | 100%+ | 不扣 Credits | 实际 Token × 标准价 | 标准价 - 成本价 = 差额利润 |

> **透传区风控**：透传区设有硬上限（默认 = 月套餐费的 3 倍），触发后熔断拒绝请求，防止客户累积无限负债。Credits 池耗尽后切换为按 Token 现金计费，是因为 Credits 已无余额可扣。

**利润计算：**

```
单客户利润 = 套餐费                          ← 固定收入
          + 超额区收费                        ← 变动收入
          + 透传区收费                        ← 变动收入
          - 成本价 × 实际 Token 用量           ← 变动成本
          - 固定成本分摊                       ← 预留容量/基础设施

其中：
  超卖利润 = 套餐费 - 成本价 × (客户实际用量)
  超额利润 = (标准价 × markup - 成本价) × 超额 Token
  透传利润 = (标准价 - 成本价) × 透传 Token
  缓存/路由优化利润 = 成本价降低，客户价格不变 → 差额增加
```

### 4.10 客户账单

**月度/年度账单结构：**

```text
账单周期：2024-03-01 ~ 2024-03-31
套餐：企业标准版（100 万 Credits/月）     ¥10,000.00

用量明细：
  Credits 使用：720,000 / 1,000,000
    ├── 订阅额度内：700,000 Credits        ¥0.00（套餐包含）
    ├── 超额收费区：20,000 Credits          ¥240.00（20K × ¥0.012/1K）
    └── 透传区：0 Credits                  ¥0.00

  模型分布：
    GPT-4o：   500K Token → 500K Credits   ¥3,500.00（成本价）
    GPT-4：    30K Token  → 120K Credits    ¥900.00（成本价）
    Claude：   100K Token → 100K Credits    ¥500.00（成本价）
    缓存命中节省：50K Token                -¥350.00

  ─────────────────────────────────────
  客户应付：                              ¥10,240.00
  我们的API成本：                         ¥4,550.00
  毛利润：                                ¥5,690.00（55.6%）
```

**成本利润追踪：**

| 维度 | 说明 |
|---|---|
| 按客户 | 每个客户的收入、API成本、利润率 |
| 按套餐 | 每种套餐的平均利润率、超卖比例 |
| 按模型 | 每个模型的成本占比、利润贡献 |
| 按时间 | 月度/季度利润趋势 |
| 缓存节省归属 | 配置：缓存节省给客户（降价）或自己留（增利） |

**退费/冲正：** 失败请求（Provider 返回 5xx）退还客户 Credits；取消请求（客户端中断）按已消耗 Token 扣 Credits。退费记录在结果账中，不影响原流水。

---

## 5. 治理

### 5.1 组织层级（三级 + 预留扩展）

```text
SaaS 模式:    Tenant(客户) > Organization > Team > Project > API Key
单一企业模式:              Organization > Team > Project > API Key
```

| 层级 | 承担 | SaaS 模式 | 单一企业模式 |
|---|---|---|---|
| Tenant(客户) | 租户隔离、超管管理 | ✅ 每个客户一个 Tenant | —（单 Tenant） |
| Organization | 全局策略、预算总池、Provider 注册 | ✅ | ✅ |
| Team | 团队预算、模型白名单、限流配额 | ✅ | ✅ |
| Project | 项目预算、API Key 管理、数据保存策略 | ✅ | ✅ |
| API Key | 调用凭据，绑定项目和权限 | ✅ | ✅ |

> SaaS 模式下，超管管理所有 Tenant（客户），每个 Tenant 内部由企业管理员管理。单一企业模式为单 Tenant，最高角色为企业管理员。
>
> V1 实现单层 Clamp：API Key 策略 ≤ Project 策略（只能更严格，不能放宽）。数据模型预留 BU（Business Unit）层级字段，V2 按需扩展到多级继承 Clamp（组织→BU→团队→项目→应用，每层不能放宽上层规则）。

### 5.2 模型访问控制

| 检查项 | 说明 |
|---|---|
| 模型白名单 | 项目/团队配置允许使用的模型列表 |
| API Key 权限 | 每个 API Key 绑定可用模型范围 |
| 预算检查 | 调用前检查所属项目/团队预算是否充足 |
| 数据区域 | 模型 Provider 的数据区域是否符合项目要求（V2） |

> V1 实现：模型白名单 + 预算检查两步。不使用三权分立框架——Token Hub 不需要独立的三套 Entitlement 系统。

### 5.3 数据保存与生命周期

**五档保存模式：**

| 模式 | 保存内容 |
|---|---|
| Full | 保存经过授权的请求和响应 |
| Redacted | 保存脱敏后的内容 |
| Metadata Only | 仅保存成本、Token、延迟和状态 |
| Zero Retention | 不持久保存正文 |
| Local Only | 正文只保存在客户环境 |

**生命周期管理：**

| 维度 | 设计方向 |
|---|---|
| 保存什么 | 由数据保存模式决定 |
| 保存多久 | 按项目配置 TTL（7天/30天/1年/永久）；空间配额按团队分配 |
| 怎么归档 | 热数据（可查询）→ 温数据（压缩，低频访问）→ 冷数据（合规留存，只读） |
| 怎么清理 | TTL 自动过期删除；删除前可选审计快照；合规最短保留期不可缩短 |
| 谁决定 | 项目管理员配默认模式；企业管理员设上下限；API Key 只能选同等或更严格 |
| Legal Hold | 即使到了 TTL 也不删除，直到解除——用于审计/合规调查 |

### 5.4 安全设计

| 机制 | 说明 |
|---|---|
| API Key 加密存储 | Provider Key 加密存储（AES-256），不明文落盘 |
| Key 不下发 | 调用方使用 Fabric API Key，Fabric 内部使用 Provider Key 转发 |
| 审计日志 | 所有路由决策、预算变更、Key 操作记录审计日志 |
| 传输加密 | 所有通信走 TLS |
| 防御性扫描 | Fabric 可选二次扫描，但只能升级不能降级数据等级 |

> **Zero Retention 模式说明**：即使配置为 Zero Retention 或 Local Only，Fabric 作为网关仍需在内存中瞬态处理明文请求/响应以做路由和归因。明文不落盘，处理完即销毁。

---

## 6. API 规格

### 6.1 原生 API

**最小请求：**
```json
{
  "model": "gpt-4",
  "messages": [{"role": "user", "content": "修复这个错误"}]
}
```

**带上下文请求：**
```json
{
  "model": "gpt-4",
  "messages": [...],
  "fabric_context": {
    "project_id": "payment-service",
    "task_type": "coding",
    "preferences": {
      "max_cost": 30,
      "mode": "balanced"
    }
  }
}
```

**task_type 受控词表：** V1 支持以下值：`coding` / `reasoning` / `chat` / `extraction` / `embedding` / `vision`。Fabric 接受自由文本但聚合时归一到这 N 类。task_type 用于 ROI 优化路由（3.5）的模型×任务类型历史聚合。

### 6.2 兼容 API

| 兼容协议 | 说明 |
|---|---|
| OpenAI | `POST /v1/chat/completions` — OpenAI SDK 直接指向 Fabric base_url |
| Anthropic | `POST /v1/messages` — Anthropic SDK 直接指向 Fabric base_url |

> 客户端只需修改 base_url，其余代码不变。Fabric 自动处理路由、限流、计量。

### 6.3 错误模型

| HTTP | 错误码 | 含义 | 可操作建议 |
|---|---|---|---|
| 429 | rate_limited | 触发限流 | 等待重试或切换到其他模型 |
| 402 | budget_exceeded | 预算耗尽（硬限制） | 申请提额或使用紧急额度 |
| 200 | soft_limit_warning | 软限制告警（响应头） | 考虑切换到更便宜的模型 |
| 503 | provider_unavailable | 所有 Provider 不可用 | 检查 Provider 状态 |
| 403 | model_not_allowed | 无权使用该模型 | 联系管理员开通权限 |
| 502 | provider_error | Provider 返回错误 | 查看 Provider 错误详情 |

---

## 7. SDK 设计

| 语言 | 说明 |
|---|---|
| Python | `pip install kodax-fabric`，兼容 OpenAI SDK 用法 |
| TypeScript | `npm install @kodax/fabric`，兼容 OpenAI SDK 用法 |
| Go | `go get github.com/kodax/fabric-go` |

**使用方式（Python 示例）：**

```python
from openai import OpenAI

# 只改 base_url 和 api_key，其余代码不变
client = OpenAI(
    base_url="https://fabric.company.com/v1",
    api_key="fab-xxxxxxxx"
)

response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "修复这个错误"}]
)
```

> 兼容 OpenAI SDK 意味着：现有用 OpenAI SDK 的应用只需改两行配置即可接入 Fabric。
>
> **Anthropic SDK 兼容**：使用 Anthropic SDK 的应用同样只需修改 base_url 指向 Fabric 的 `/v1/messages` 端点。Fabric 同时支持 OpenAI 和 Anthropic 两种 SDK 接入方式（见 3.1 协议适配策略）。

---

## 8. 指标和监控

### 8.1 北极星指标

```
Token ROI = 有价值 Token 成本 / 总 Token 成本
```

> 北极星指标是 Token ROI（Fabric 独立计算）。当企业部署 KodaX Agent 体系时，补充指标 Outcome ROI 自动激活。

### 8.2 指标分类

| 类别 | 指标 |
|---|---|
| **ROI** | Token ROI、Outcome ROI（如有）、浪费比例、缓存节省 |
| **用量** | 总 Token 数（输入/输出/缓存/推理分类）、请求数、活跃 API Key 数 |
| **成本** | 总成本、每千 Token 成本、每项目成本、每团队成本 |
| **路由** | 模型分布、Provider 分布、Fallback 次数、熔断次数 |
| **健康** | Provider 错误率、P99 延迟、限流触发次数、缓存命中率 |
| **预算** | 预算使用率、软限制触发次数、硬限制拦截次数 |

### 8.3 实时 ROI 仪表盘

| 组件 | 说明 |
|---|---|
| 实时 Token ROI | 当前小时/天的 ROI 数值和趋势线 |
| 浪费热力图 | 按团队/项目/模型展示浪费成本占比 |
| 模型 ROI 对比 | 同一任务类型下不同模型的 ROI 柱状图 |
| 成本瀑布 | 按组织→团队→项目下钻的成本分布 |
| 告警面板 | 软限制告警、ROI 低于阈值、浪费高于阈值 |

---

## 9. 部署与可靠性

### 9.1 部署模式

| 模式 | 说明 | 适合 |
|---|---|---|
| SaaS/平台 | Fabric 托管，超管管理 Commerce（对外卖 Token），企业管理员管理本企业 | KodaX 自身或合作伙伴对外提供 Token 服务 |
| 单一企业 | Fabric 部署在企业内网或私有云，企业管理员管理全部 | 企业内部 Token 管理 |

> **定价与计费界面（12-14）的启用条件**：取决于模型来源而非部署模式。使用外部 API Provider（OpenAI/Anthropic 等）时启用——SaaS 模式为商业计费（Credits/split/markup/利润追踪），单一企业模式为内部成本核算（标准价=团队收费价，成本价=API 成本）。仅使用自建模型（vLLM 等自有算力）时不启用，配额由预算管理覆盖，用量由用量分析覆盖。

### 9.2 可靠性目标

| 指标 | 目标 |
|---|---|
| 网关可用性 | 99.9% |
| 路由延迟 | P99 < 50ms（不含 Provider 响应） |
| 实时计量精度 | 与 Provider 实时 usage 误差 < 1% |
| 对账精度 | 与 Provider 月账单差异可追溯，容差 0.5-1%（用 Adjustment 机制处理） |
| 故障恢复 | Provider 故障 → 自动转移 < 5s |

### 9.3 故障处理

| 场景 | 处理 |
|---|---|
| Provider 全部不可用 | 返回 503 + 最近一次成功的缓存响应（如配置允许） |
| Fabric 自身故障 | 客户端可配置直连 Provider 作为 Fallback |
| 计量数据丢失 | 基于 Provider 账单补录 |

**缓存响应规则：** Provider 全部不可用时，仅对确定性任务返回缓存响应，且必须添加 `x-fabric-stale: true` 响应头。缓存响应不计 Provider 成本，但记录为「降级响应」。

**Fabric 自身高可用：** 99.9% 可用性需要多网关副本部署。关键共享状态（限流计数器、预算余额、渠道健康状态）通过 Redis 或分布式存储保证跨节点一致性。客户端可配置直连 Provider 作为最终兜底。

---

## 10. 管理控制台

> **现行落地**：共用 `/admin` 壳 + 三角色裁菜单与数据。`role` 字段见文首。超管不做。
>
> Fabric 管理控制台支持四种角色：超管（平台运营）、企业管理员、团队管理员、开发者。同一界面对不同角色显示不同范围的数据，数据范围通过 Virtual Key → Project → Team 链路自动过滤。
>
> **部署模式决定角色和界面**：
>
> | 部署模式 | 包含角色 | 界面数 | 说明 |
> |---|---|---|---|
> | **单一企业 + 外部 API** | 企业管理员、团队管理员、开发者 | 全部 17 个 | 无超管。企业管理员管理全部界面（含 Pricebook/套餐/账单）。Pricebook 为内部定价（标准价=团队收费价，成本价=API 成本），套餐为内部预算套餐，账单为内部成本报告（无三层利润分解），客户=内部团队 |
> | **单一企业 + 仅自建模型** | 企业管理员、团队管理员、开发者 | 14 个（1-11 + 15-17） | 无超管，无 Commerce 界面（12-14）。配额由预算管理（5）覆盖，用量由用量分析（7）覆盖。Fabric 不计算 GPU 完全成本 |
> | **SaaS/平台部署** | 超管 + 企业管理员、团队管理员、开发者 | 全部 17 个 | 超管管理 Commerce（Pricebook/套餐/客户账单），对外卖 Token。企业管理员管理本企业配置，不含 Commerce 界面 |

### 10.1 角色与数据范围

| 角色 | 可见范围 | 典型用户 | 部署模式 |
|---|---|---|---|
| 超管（平台运营） | 所有客户、全局配置、Commerce 模块 | KodaX 平台运营团队 | **仅 SaaS 模式** |
| 企业管理员 | 本企业所有团队/项目、Provider/路由/预算/限流/数据策略、Pricebook/套餐/账单（单一企业模式） | 企业 IT / 平台团队 | 所有模式 |
| 团队管理员 | 本团队项目、VK 审批、团队预算/用量 | 团队 Tech Lead | 所有模式 |
| 开发者 | 自己的 VK、自己项目的用量/ROI、API 文档 | 开发工程师 | 所有模式 |

### 10.2 界面清单

| 页面 | 功能 | 超管 | 企业管理员 | 团队管理员 | 开发者 |
|---|---|---|---|---|---|
| **总览仪表盘** | 北极星指标、Provider 健康、Top 浪费 | ✅ 全局 | ✅ 本企业 | ✅ 本团队 | ✅ 自己的 |
| **Provider & 渠道管理** | Provider 注册、渠道池化、Key 管理、健康监控 | ✅ | ✅ | ❌ | ❌ |
| **路由配置** | 模型别名、路由策略、Fallback、重试、ROI 优化 | ✅ | ✅ | ❌ | ❌ |
| **Virtual Key 管理** | VK 创建/管理、预算/限流/模型范围 | ✅ 全部 | ✅ 本企业 | ✅ 本团队 | ✅ 自己的 |
| **VK 自服务申请** | 开发者申请 VK（项目名、描述、预算、模型范围）→ 审批 | ❌ | ❌ | ❌ | ✅ |
| **预算管理** | Budget Waterfall、软/硬限制、预算预占 | ✅ 全局 | ✅ 本企业 | ✅ 本团队 | ✅ 只读 |
| **ROI 仪表盘** | ROI 趋势、浪费分解、模型对比、路由优化建议 | ✅ 全局 | ✅ 本企业 | ✅ 本团队 | ✅ 自己的 |
| **用量分析** | 成本瀑布下钻、Token 分类、文件级归因 | ✅ 全局 | ✅ 本企业 | ✅ 本团队 | ✅ 自己的 |
| **Run Explorer** | 单次请求全链路：路由→调用→分类→归因→ROI | ✅ 全部 | ✅ 本企业 | ✅ 本团队 | ✅ 自己的 |
| **限流配置** | 四维限流、四种策略、实时状态 | ✅ | ✅ | ✅ 本团队 | ❌ |
| **审计日志** | 路由/预算/Key/渠道审计、事件详情 | ✅ 全部 | ✅ 本企业 | ✅ 本团队 | ✅ 自己的 |
| **数据保存策略** | 五档模式、TTL、归档分级、Legal Hold | ✅ | ✅ | ✅ 本团队 | ❌ |
| **开发者面板** | 我的 Keys、我的用量、快速接入代码 | ❌ | ❌ | ❌ | ✅ |
| **团队管理员面板** | VK 审批队列、团队概览、项目列表、成员管理 | ❌ | ❌ | ✅ | ❌ |
| **Pricebook 管理** | SaaS: 商业定价（标准价=客户价，成本价=内部成本）；单一企业: 内部定价（标准价=团队收费价，成本价=API 成本） | ✅ | ✅ (单一企业) | ❌ | ❌ |
| **套餐管理** | SaaS: 商业套餐（Credits/split/markup）；单一企业: 内部预算套餐（Token 额度/模型范围） | ✅ | ✅ (单一企业) | ❌ | ❌ |
| **客户管理 & 账单** | SaaS: 客户账单+利润追踪；单一企业: 内部团队成本报告（无三层利润分解） | ✅ | ✅ (单一企业) | ❌ | ❌ |

> **Commerce 界面（12-14）的适用场景**：
> - SaaS/平台模式：由超管管理，完整商业功能（Credits/split/markup/三层计量/利润追踪）
> - 单一企业 + 外部 API：由企业管理员管理，功能简化（内部定价/内部预算套餐/内部成本报告，无三层利润分解）
> - 单一企业 + 仅自建模型：不显示 Commerce 界面。配额由预算管理（5）覆盖，用量由用量分析（7）覆盖
>
> **两套价格的适用条件**：当企业使用外部 API Provider（OpenAI/Anthropic 等）时，维护两套价格——标准价（团队收费价/客户价）和成本价（实际 API 成本）。当企业仅使用自建模型（vLLM 等自有算力）时，无需成本价（Fabric 不计算 GPU 完全成本，属企业 FinOps），Pricebook 可选或仅维护标准价用于配额管理。
>
> **Virtual Key 申请流程**：开发者在界面填写项目名、描述、期望预算、模型范围、过期时间 → 提交至团队管理员审批 → 审批通过后生成 Virtual Key（仅显示一次）→ Key 自动绑定到指定项目。项目名在申请时确定，创建后不可修改——这是成本归因和预算绑定的基础。

---

## 11. 设计总结

> 本节是对 Fabric 完整设计的言简意赅的总结：能做什么、给企业级客户带来什么收益、我们有什么商业模式。

### 11.1 能做什么

| 模块 | 核心能力 | 一句话 |
|---|---|---|
| **Token Hub 接入管理** | 双端点零转换网关（OpenAI / Anthropic）、渠道池化、Virtual Key、路由负载均衡、限流熔断、缓存、流式透传 | 所有 LLM API 调用经过一个网关，统一路由、限流、故障转移 |
| **Token ROI** | Token 分类（输入/输出各 5 类，价值加权）、ROI 公式、文件级成本归因、浪费检测（重试放大/循环/上下文膨胀/无效花费/缓存未命中）、ROI 监控对比 | 不只看花了多少钱，看 Token 花得值不值、浪费在哪 |
| **计量计费** | 四套账本（用量/容量/经济/结果）、Budget Waterfall、预算软硬限制、预算预占、结算对账 | 精确知道每个团队/项目/Run/文件花了多少，预算可控 |
| **治理** | 组织层级（组织→团队→项目→API Key）、模型访问控制、五档数据保存、安全设计 | 谁能用什么模型、数据保存多久、合规可控 |
| **定价与计费** | Pricebook 双套价格、套餐管理、账单。SaaS: 商业计费（Credits/split/markup/利润追踪）；单一企业: 内部成本核算（无三层利润分解）；仅自建模型: 不启用 | 对外卖 Token 或内部成本核算 |

**关键设计决策：**

- **不转换协议**：OpenAI 端点只透传 OpenAI 系，Anthropic 端点只透传 Anthropic 系——零 bug、零功能丢失
- **不调用 LLM**：所有优化用统计方法（bandit 算法做 ROI 优化路由），不产生预算外 Token 成本
- **两层 ROI 分离**：Token ROI（Fabric 独立，始终可用）+ Outcome ROI（部署 KodaX Agent 体系时自动激活）
- **定价与计费的启用条件**：取决于模型来源。使用外部 API 时启用（SaaS=商业计费，单一企业=内部成本核算）；仅自建模型时不启用

### 11.2 给企业级客户带来什么收益

| 角色 | 痛点 | Fabric 解决 |
|---|---|---|
| **管理者 / CIO** | 看不清 Token 花在哪、不知道哪些是浪费 | Token ROI 仪表盘：每个团队/项目/模型的 Token 效能、浪费比例、成本趋势 |
| **平台团队** | 每个业务系统重复建 Provider SDK / Key / 限流 / 重试 | 一套网关管所有 Provider，自动限流、故障转移、渠道池化 |
| **开发者** | 要管 Provider、Key、限流、Fallback | 只改 base_url 指向 Fabric，其余由 Fabric 处理 |
| **普通用户** | 不懂模型、不懂预算 | 在 KodaX Space 中输入任务，Fabric 后台路由和计量 |

**核心价值：**

1. **省钱**——发现浪费（重试放大、上下文膨胀、缓存未命中），ROI 优化路由推荐更优模型
2. **省心**——统一网关，自动故障转移，Key 轮换，不用每个系统重复造轮子
3. **透明**——每个 Token 花在哪、花得值不值、哪个文件花了多少，全部可追溯
4. **可控**——预算软硬限制，超额告警拦截，数据保存五档可选，合规审计

**对比竞品的独特优势：** LiteLLM（54.5k stars）、One API（35.9k stars）做的是基础网关——路由、限流、Key 管理。Token ROI / Token 分类 / 文件级成本归因 / 浪费检测 / ROI 优化路由——竞品全无，这是 Fabric 的护城河。

### 11.3 商业模式

```text
Fabric Core（所有部署的基础）          Fabric Commerce（可选，SaaS/平台模式）
├── Token Hub 接入管理                  ├── Pricebook 双套价格（标准价 ≠ 成本价）
├── Token ROI                           ├── AI Credit 倍率体系
├── 计量计费（内部成本追踪）             ├── 套餐管理（企业/SMB/个人三层）
├── 治理                                ├── 三层计量（订阅→超额→透传）
└── 管理控制台                          └── 客户账单 + 利润追踪
```

**两条收入路径：**

| 路径 | 模式 | 收入来源 |
|---|---|---|
| **卖软件** | 企业买 Fabric Core 部署在内网 | 软件许可费 / 订阅费 |
| **卖服务** | KodaX 自己用 Fabric Core + Commerce 对外卖 Token | 套餐费 + 超额收费 + 透传收费 |

**SaaS 卖 Token 的利润模型（三层计量）：**

```text
套餐：100 万 Credits / ¥10,000 / 月    Split: 70/30

  0 ──── 70万 ──── 100万 ──── ∞
  │ 订阅额度内 │  超额收费区  │ 透传区
  │ 扣Credits  │ 扣Credits   │ 不扣Credits
  │ 不额外收费 │ +收超额费    │ +收透传费
  │            │ (标准价×markup)│ (标准价×Token)
  └────────────┴─────────────┴──────
  ← 套餐费已含 → ← 客户额外付费 →
```

| 利润来源 | 机制 |
|---|---|
| **超卖利润** | 客户买了 100 万 Credits 但只用了 72 万——套餐费不变，成本只付实际用量 |
| **超额利润** | 70-100% 区间收标准价 × markup（1.1-2.0），markup = 纯利润 |
| **透传利润** | 100%+ 区间按标准价收现金，标准价 - 成本价 = 差额利润 |
| **缓存/路由优化利润** | Fabric 优化降低成本价，客户价格不变，差额增加 |

> **透传区风控**：透传区设有硬上限（月套餐费 3 倍），触发后熔断，防止无限负债。

### 11.4 技术路线

```text
Phase 1: 最小网关（双端点透传 + 基本计量）
    ↓
Phase 2: 渠道池化 + Virtual Key + 预算控制
    ↓
Phase 3: Token ROI（分类 + 文件归因 + 浪费检测）
    ↓
Phase 4: Fabric Commerce（套餐 + Credits + 三层计量）
    ↓
Phase 5: ROI 优化路由（bandit 算法，统计学习）
```

---

## 附录：归属 KodaX 其他体系的能力

> 以下能力属于 KodaX Space / Runtime（执行层）或企业 FinOps，不属于 Fabric（Token Hub + Token 效能管理）。Fabric 是这些能力的消费者或数据接收方。

| # | 能力 | 归属 | 原因 |
|---|---|---|---|
| 1 | 用户认证（SSO） | Space | 认证是用户交互第一步，天然在用户入口 |
| 2 | 项目 / Workspace 绑定 | Space | 环境自带，不从文本推断 |
| 3 | 数据等级判定（含 DLP 扫描） | Space / Runtime | 数据入口在 Space，标签是 Space 资产配置 |
| 4 | 任务类型分类 | Space / Runtime | 属于上下文，不是 Token Hub 职责 |
| 5 | Agent 执行、Workflow、Tool Calling | Runtime | 运行语义 |
| 6 | Agent 预算树和工具权限 | Runtime | Agent 治理是执行层职责 |
| 7 | 运行中控制（模型降级/停止/切换） | Runtime | 执行决策由 Runtime 做，Fabric 只报告状态 |
| 8 | Outcome Evidence 采集 | Runtime / Space | PR 合并/工单状态/业务回调需对接外部系统 |
| 9 | Artifact 指纹生成 | Runtime | Runtime 始终有 Artifact 内容 |
| 10 | 完全成本计算 | 企业 FinOps | 需对接固定资产台账和折旧政策 |
| 11 | 身份委托链构建 | Runtime | Agent spawn 时自然产生 |

---

## 展望：从 Token 管理到 AI 产能管理

> 以下为未来扩展方向，不在当前 PRD 范围内。

当前 Fabric 聚焦于 **Token Hub + Token ROI**——统一接入所有 LLM API，衡量 Token 投入产出比。这是 Fabric 的 V1 基石。

未来，Fabric 可以从 Token 管理向 **AI 产能管理** 扩展：

```text
V1（当前）                    未来扩展
─────────                    ─────────
Token Hub                    AI 产能 Hub
统一接入 LLM API              统一管理所有 AI 资源（GPU 集群、预付额度、边缘模型）
                             │
Token ROI                    AI 产能 ROI
衡量 Token 效率               衡量产能利用率 + 经济性
                             │
简单路由 + ROI 优化            智能产能调度
模型别名 + 统计推荐            多维产能感知调度（GPU/CPU/内存/区域/合同）
                             │
三级访问控制                  企业级策略体系
组织→团队→项目                法律→企业→BU→团队→项目→应用（继承 + Clamp）
                             │
预算管理                      Agent 经济性
软/硬限制                     Agent 预算树、子 Agent 控制、Outcome 经济单位
```

**扩展路径：**

1. **Token ROI 数据积累** → 发现产能利用模式（哪个 Provider 利用率低、哪个模型浪费多）
2. **产能利用率分析** → 从 Token 层面向产能层面延伸（Provider 维度的 RPM/TPM/并发利用率）
3. **智能产能调度** → 基于利用率 + ROI + 合同价值的综合调度（统计方法，不调用 LLM）
4. **Agent 经济性** → 当企业部署 KodaX Agent 体系时，从 Token 级经济性扩展到 Run/Agent/Outcome 级经济性

**关键约束（扩展时仍需遵守）：**
- 不调用 LLM 做硬规则决策
- 不重新实现 Agent Runtime
- 确定性约束优先于智能优化
- 所有路由决策可审计

> Token ROI 是 AI 产能管理的基础——没有 Token 级别的精确计量和效率分析，产能管理就是空中楼阁。V1 把 Token Hub + Token ROI 做扎实，是未来扩展的前提。
