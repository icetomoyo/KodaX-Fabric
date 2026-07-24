# KodaX Fabric 产品完整设计

> 工作名称：**KodaX Fabric**  
> 产品类别：**企业 AI 产能与 Agent 经济性控制平面**

这版设计保留“每次执行都拥有完整上下文”的能力，但调整一个关键原则：

> **普通用户只描述任务，开发者只声明服务意图；复杂的身份、预算、合规、模型和调度信息，由系统自动编译。**

原来的 **Run Envelope** 不再作为对外协议，而改为内部对象 **Compiled Run——编译后执行对象**。

---

# 一、产品定义

## 1. 一句话定义

KodaX Fabric 将企业拥有的外部模型 API、自建推理集群、预付额度、云端模型部署、工具服务和 Agent 运行资源，统一抽象为可接入、可分配、可治理、可计量和可优化的 AI 产能。

它解决的核心问题不是：

> 企业用了多少 Token？

而是：

> 企业有哪些 AI 产能，这些产能应该由谁、为哪个任务、在什么约束下使用，最终产生了什么结果？

---

## 2. 产品完整形态

```text
统一模型与工具接入
        +
企业身份与权限
        +
AI 产能池
        +
任务与 Agent 调度
        +
预算和成本账本
        +
数据与模型治理
        +
Run 级可观测性
        +
业务结果与经济性优化
```

可以将产品能力表达为：

[  
KodaX\ Fabric =  
Access

- Capacity
    
- Scheduler
    
- Governance
    
- Ledger
    
- Outcome  
    ]
    

---

## 3. 产品使命

> 让企业的每一份 AI 产能，都流向当前最合适、最有价值且符合组织政策的任务。

---

# 二、产品核心价值

## 1. 对企业管理者

管理者可以看到：

- 企业采购和自建了哪些 AI 产能；
    
- 哪些产能正在闲置、拥堵或即将到期；
    
- 哪些团队、项目和 Agent 正在消费；
    
- 每项业务结果的真实 AI 成本；
    
- 哪些模型和工作流产生了有效结果；
    
- 哪些成本来自重试、循环、失败和无效输出。
    

最终从“模型账单管理”升级为：

> **企业 AI 投资组合管理。**

---

## 2. 对 AI Platform 和基础设施团队

平台团队不再需要为每个业务系统分别建设：

- Provider SDK；
    
- API Key 管理；
    
- 限流；
    
- 重试；
    
- Fallback；
    
- 模型切换；
    
- 预算；
    
- 审计；
    
- 自建和外部资源溢出。
    

业务应用只调用一个统一服务意图，Fabric 负责完成后续决策。

---

## 3. 对开发者和 Agent 作者

开发者只需要声明：

```text
我要完成什么任务
我需要哪一类服务
我是否有额外的时间、质量或成本偏好
```

不需要决定：

```text
调用哪一家 Provider
使用哪个账户
预算从哪里扣
请求进入哪个 GPU 集群
数据可以进入哪个区域
失败后如何切换
```

---

## 4. 对普通用户

用户只需要在 KodaX Space 中输入：

```text
修复当前项目的 CI 错误
```

系统自动确定：

- 当前用户和团队；
    
- 所属项目；
    
- 数据敏感等级；
    
- 可使用的模型范围；
    
- 预算来源；
    
- 最大执行成本；
    
- Agent 和工具权限；
    
- 是否允许外部模型；
    
- 当前最合适的产能源。
    

---

# 三、核心设计原则

## 原则一：意图简单，执行完整

对外接口只承载用户意图。

完整的身份、权限、预算、治理和调度信息由系统生成——但分两层：**Space / Runtime 确立上下文，Fabric 施加约束。**

```text
── Space / Runtime 确立上下文 ──
用户意图
    +
可信身份
    +
项目上下文
    +
数据等级
    =
可信上下文请求
          ↓
── Fabric 施加约束 ──
组织默认值
    +
企业策略
    +
实时产能
    =
完整执行对象（Compiled Run）
```

---

## 原则二：默认继承，按需覆盖

大量配置不应该在每次请求中重复提交，而应该绑定在：

```text
组织
└── 业务单元
    └── 团队
        └── 项目
            └── 应用 / Workflow
                └── Run
```

例如项目已经配置：

```text
默认数据等级：机密
默认服务等级：coding.standard
外部模型：禁止
默认预算账户：支付业务研发
单次任务硬上限：30 元
最大子 Agent：4
默认执行区域：中国私有云
```

该项目下的 Run 自动继承这些配置。

---

## 原则三：用户偏好不能突破企业政策

用户和应用提交的是 **Hint——意图提示**，不是最终授权。

例如用户可以：

- 将预算上限设得更低；
    
- 要求更严格的隐私模式；
    
- 表示愿意排队；
    
- 选择快速或深度模式。
    

但用户不能：

- 提升自己无权获得的优先级；
    
- 把机密数据降级成公开数据；
    
- 指定使用自己无权访问的模型；
    
- 将成本计入其他部门；
    
- 扩大子 Agent 权限；
    
- 绕过区域限制。
    

有效配置的计算可以理解为：

[  
EffectiveRun =  
Clamp(  
InheritedDefaults + UserHints,  
HardPolicies  
)  
]

具体合并规则：

|配置类型|合并原则|
|---|---|
|允许模型列表|取交集|
|禁止规则|取并集|
|数据等级|采用更高等级|
|隐私要求|采用更严格要求|
|最大预算|采用更低上限，提额需授权|
|工具权限|取授权范围交集|
|优先级|不超过调用者授权等级|
|执行区域|取政策允许区域交集|
|Agent 深度|不能超过父级和项目限制|

---

## 原则四：模型 Token 不能被强行视为统一物理资源

不同模型的 Token 不具有天然等价关系。

Fabric 不建立一个虚假的统一 Token 数，而是分别管理：

1. **原生用量**
    
2. **实时容量**
    
3. **财务成本**
    
4. **任务结果**
    

用户可以看到统一的货币预算或企业 AI Credit，但 AI Credit 是经济单位，不是模型 Token 的物理换算。

---

## 原则五：容量、预算和权限相互独立

一次 Run 必须同时拥有三种权利：

### Policy Entitlement

这个主体是否有权使用该模型、工具、区域和数据处理方式。

### Capacity Entitlement

这个主体是否有权使用某个产能池。

### Financial Entitlement

这个任务由哪个预算账户承担费用。

例如：

```text
任务可以使用企业私有 GPU
成本由支付项目承担
但不能调用公共外部模型
```

这三个条件不能被合并成一个简单的 Token 余额。

---

## 原则六：先做确定性约束，再做智能优化

调度分两步：

### 第一步：硬约束过滤

确定哪些资源合法、可用、满足能力和预算要求。

### 第二步：在合法候选中优化

按照质量、成本、延迟、利用率和合同价值进行选择。

安全、数据、合规和预算硬限制不能交给 LLM 自由判断。

---

## 原则七：以 Run 和 Outcome 为经济单位

请求只是技术对象，Run 才是业务对象。

Fabric 的主要分析单位应是：

```text
用户
→ 项目
→ Run
→ Agent
→ 子 Agent
→ 模型调用
→ 工具调用
→ Artifact
→ Outcome
```

最终关注：

[  
Cost\ per\ Accepted\ Outcome  
]

而不是：

[  
Cost\ per\ Token  
]

---

# 四、产品领域模型

完整领域模型分为需求侧、供给侧、治理侧和经济侧。

---

## 1. 组织层级

```text
Organization
└── Business Unit
    └── Team
        └── Project
            ├── Application
            ├── Workflow
            ├── Workspace
            └── Session
                └── Run
                    ├── Step
                    ├── Agent
                    ├── Invocation
                    ├── Tool Call
                    └── Outcome
```

组织层级承担：

- 配置继承；
    
- 成本归因；
    
- 权限控制；
    
- 预算分配；
    
- 产能授权；
    
- 审计范围。
    

---

## 2. Principal：执行主体

Principal 不只是人类用户，还包括：

- Human User；
    
- Service Account；
    
- Application；
    
- Workflow；
    
- Agent；
    
- Child Agent；
    
- Tool；
    
- 外部 A2A Agent。
    

每一次执行都保留完整委托链：

```text
Human
→ KodaX Space
→ Workflow
→ Main Agent
→ Child Agent
→ Tool
```

这样系统不仅知道“哪个 API Key 调用了模型”，还知道：

> 谁发起、谁代理、谁执行、谁调用了工具。

---

## 3. Capacity Source：产能源

产能源表示企业真实拥有的一项 AI 资源。

例如：

- 某个外部模型 Provider 企业账户；
    
- 某个 Azure 或云模型 Deployment；
    
- 某个自建 vLLM 集群；
    
- 某个部门采购的预付模型额度；
    
- 某个边缘设备上的本地模型。

> **注意**：搜索 API、MCP 服务、Sandbox 等非 LLM 资源由 Runtime 管理和执行，不属于 Fabric 的产能源。Runtime 调用这些资源后向 Fabric 报告用量，Fabric 负责成本归因和记账。
    

产能源包含：

```text
所有者
Provider 类型
模型或工具能力
部署区域
访问凭据
实时容量
限流规则
合同和价格
余额或到期时间
数据政策
健康状态
```

---

## 4. Capacity Pool：产能池

Capacity Pool 是一个或多个产能源组成的逻辑资源池。

例如：

```text
企业私有 Coding Pool
├── 上海 vLLM 集群
├── 北京 GPU 集群
└── 私有云 Coding Deployment
```

或者：

```text
外部通用推理 Pool
├── Provider A 企业账号
├── Provider B 预付账号
└── Provider C 按量账号
```

产能池包含：

- 保底容量；
    
- 共享容量；
    
- 可借用容量；
    
- 预留容量；
    
- 突发容量；
    
- 所有者；
    
- 可使用团队；
    
- 数据和区域限制；
    
- 调度优先级；
    
- 当前可用状态。
    

---

## 5. Service Class：服务等级

业务应用不应该默认依赖具体模型名称，而应该请求某类能力：

```text
coding.fast
coding.standard
coding.deep
coding.private
document.summary
document.private
reasoning.standard
reasoning.premium
classification.bulk
customer-service.realtime
```

Service Class 描述：

- 任务能力要求；
    
- 质量下限；
    
- 延迟目标；
    
- 上下文范围；
    
- 模态；
    
- Tool Calling 能力；
    
- 数据处理要求；
    
- 成本等级；
    
- 可否降级；
    
- 候选模型和产能池。
    

Service Class 需要版本化：

```text
coding.deep@v7
```

业务应用可以保持不变，平台在后台灰度替换实际模型。

---

## 6. Run Request：对外轻量请求

这是普通开发者真正需要提交的对象。

最小请求：

```json
{
  "input": "修复当前项目的 CI 错误",
  "service_class": "coding.standard"
}
```

标准请求：

```json
{
  "input": "修复当前项目的 CI 错误",
  "service_class": "coding.standard",
  "project_id": "payment-service",
  "preferences": {
    "mode": "balanced",
    "allow_queue": true
  }
}
```

高级请求：

```json
{
  "input": "修复生产环境支付异常",
  "service_class": "coding.deep",
  "project_id": "payment-service",
  "preferences": {
    "deadline_ms": 60000,
    "max_cost": 30,
    "privacy": "private",
    "fallback": "quality-first"
  }
}
```

其中 `max_cost`、`priority` 和 `privacy` 都是请求偏好，仍需经过平台授权。

---

## 7. Execution Context：可信执行上下文

Execution Context 由 **KodaX Space / Runtime 确立并背书**，不是由 Fabric 补齐。

Space / Runtime 天然拥有这些信息——用户在 Space 登录、打开项目、读写文件、运行 Agent。Fabric 是上下文的消费者，不是生产者。

Space / Runtime 确立的上下文包括：

- 用户；
    
- 团队；
    
- 项目；
    
- 应用；
    
- 当前 Workspace；
    
- 仓库；
    
- 环境；
    
- 会话；
    
- 父级 Run；
    
- 数据源；
    
- 成本中心；
    
- 当前身份委托链。
    

这些信息来自 Space / Runtime 的可信来源：

- SSO；
    
- 企业目录；
    
- KodaX Space；
    
- SDK；
    
- Workflow；
    
- 项目绑定；
    
- Gateway；
    
- 数据源标签。
    

Space / Runtime 将上述信息打包为**可信上下文**，随 Run Request 一并发给 Fabric。不能依赖调用者随意构造的 Header——上下文必须由执行层背书，Fabric 信任并校验，但不自行推导。

---

## 8. Effective Policy：生效策略

策略引擎生成本次 Run 的强制约束：

```text
允许的 Service Class
允许的模型
允许的产能池
数据处理区域
是否允许外部模型
预算账户
预算硬上限
最大 Agent 迭代
最大子 Agent 数
最大工具权限
审批要求
内容保留方式
Fallback 范围
```

---

## 9. Compiled Run：内部编译后执行对象

原来的 Run Envelope 调整为内部对象 **Compiled Run**。

编译过程分两层：

```text
Space / Runtime 编译上下文：
  Run Request + 可信身份 + 项目上下文 + 数据等级 + 委托链
  = Context-Attested Request

Fabric 编译约束：
  Context-Attested Request + 组织默认值 + 企业策略 + 产能授权 + 预算授权
  = Compiled Run
```

```text
Compiled Run
├── Run Request              ← 来自用户
├── Execution Context         ← Space / Runtime 确立并背书
├── Effective Policy          ← Fabric 编译
├── Capacity Entitlements     ← Fabric 编译
├── Financial Entitlements    ← Fabric 编译
├── Estimated Demand          ← Fabric 编译
└── Execution Constraints     ← Fabric 编译
```

普通用户和大部分开发者不需要看到它。

它用于：

- 调度；
    
- 审计；
    
- 策略重放；
    
- 预算预占；
    
- 事故分析；
    
- 运行复现。
    

---

## 10. Run Grant：短期执行授权

通过策略和预算检查后，系统签发一个短期、不可扩大权限的 Run Grant。

它包含：

- Principal；
    
- Run ID；
    
- 允许的 Service Class；
    
- 最大预算；
    
- 允许模型和工具；
    
- 数据等级；
    
- 最大委托深度；
    
- 最大 Agent 数；
    
- 有效期；
    
- 父级 Run；
    
- Policy Version。
    

子 Agent 的授权必须满足：

[  
ChildGrant \subseteq ParentGrant  
]

子 Agent 可以获得父级权限的子集，但不能自行扩大权限。

---

## 11. Execution Plan：实际执行计划

调度器最终生成：

- 使用哪个 Capacity Pool；
    
- 选择哪个具体产能源；
    
- 使用哪个模型版本；
    
- 预占多少预算；
    
- 是否需要排队；
    
- Fallback 顺序；
    
- 是否使用借入容量；
    
- 是否允许模型升级或降级；
    
- 最大执行时长。
    

Execution Plan 是实时对象，会受到当前容量和健康状态影响。

---

## 12. Outcome：任务结果

Outcome 不只是“请求成功返回 200”。

建议分成四级：

|级别|含义|示例|
|---|---|---|
|L0：Delivery|技术上完成响应|模型正常返回|
|L1：Verification|通过机器验证|测试通过、格式正确|
|L2：Acceptance|被用户接受和使用|用户采用代码或文档|
|L3：Business Impact|产生业务结果|PR 合并、工单解决、流程完成|

一个 Run 可以有多个 Outcome Evidence。**Fabric 接收 Runtime / Space 报告的 Evidence，不直接采集**：

```text
测试结果           ← Runtime 报告
用户确认           ← Space 报告
Artifact 使用记录   ← Runtime 报告
PR 合并事件         ← Runtime/Space 集成 Git 后报告
工单状态            ← Runtime/Space 集成工单系统后报告
业务系统回调         ← Runtime/Space 集成业务 API 后报告
Verifier 评分       ← Runtime 报告
```

> **注意**：PR 合并事件、工单状态、业务系统回调需要 Runtime / Space 对接外部系统后向 Fabric 报告。Fabric 不直接对接这些外部系统。详见附录。

Fabric 必须区分：

```text
模型成功响应
≠
任务成功
≠
结果被使用
≠
产生业务价值
```

---

# 五、配置生成与继承机制

## 1. 任务类型如何确定

> **归属：KodaX Space / Runtime。** 任务类型是上下文（“这是什么类型的任务”），由执行层判定，Fabric 接收后用于调度。

任务类型解析优先级：

```text
显式 Workflow 类型
    >
应用模板配置
    >
项目默认类型
    >
Service Class
    >
规则识别
    >
轻量任务分类器
    >
通用默认类型
```

例如：

- `fix-ci` Workflow 已经明确是 `coding.fix_ci`；
    
- 合同审查应用默认是 `document.legal_review`；
    
- 通用聊天框才需要自动分类。
    

自动分类器只用于补充信息，不能降低数据等级或绕过安全策略。Space / Runtime 判定任务类型后，连同数据等级一起作为可信上下文发给 Fabric；Fabric 只接收，不重新判定。

---

## 2. 数据等级如何确定

> **归属：KodaX Space / Runtime。** 数据入口在 Space，文件和仓库标签是 Space 的资产配置，运行时内容识别（DLP 扫描）也应在数据发出前由 Space 完成。Fabric 只接收数据等级并执行策略。

数据分类来源（由 Space / Runtime 判定，取所有信号最高等级）：

- 项目固定标签；
    
- 数据连接器标签；
    
- 文件或仓库标签；
    
- 企业 DLP 规则；
    
- 运行时内容识别；
    
- 用户主动选择更严格等级。
    

最终采用更高等级：

```text
项目：Internal
上传文件：Confidential
用户请求：Private

最终：Confidential / Private 中更严格者
```

系统不能因为自动分类器置信度低，就将数据降级。

Space / Runtime 判定数据等级后，将其作为可信上下文发给 Fabric。Fabric 基于数据等级执行策略（如“Confidential 禁止外部模型”、“必须脱敏”、“只能私有区域”）。Fabric 可选地进行防御性深度扫描，但只能升级不能降级，作为安全网而非主判定。

---

## 3. 预算如何确定

预算来源顺序可以采用 Budget Waterfall：

```text
项目专项预算
    ↓
团队保底预算
    ↓
团队共享预算
    ↓
业务单元公共预算
    ↓
企业公共预算
    ↓
临时审批预算
```

用户不需要指定从哪个账户扣款。

系统根据：

- 项目绑定；
    
- 成本中心；
    
- 预算余额；
    
- 借用规则；
    
- 任务优先级；
    
- 组织政策；
    

自动选择预算来源。

---

## 4. Service Class 如何确定

优先级：

```text
用户明确选择
    >
Workflow 固定配置
    >
应用默认
    >
项目默认
    >
任务分类推荐
    >
组织默认
```

但用户选择仍不能突破策略。

例如用户选择 `coding.deep`，但当前项目只允许 `coding.standard`，系统可以：

- 使用 `coding.standard`；
    
- 解释发生了策略降级；
    
- 或要求审批。
    

---

# 六、三档使用复杂度

## 1. 零配置模式

适合 KodaX Space 和普通用户：

```typescript
kodax.run("修复这个错误");
```

系统自动推断全部上下文。

---

## 2. 标准模式

适合绝大部分业务开发者：

```typescript
kodax.run({
  input: "总结这个客户工单",
  serviceClass: "document.standard",
  projectId: "customer-support"
});
```

开发者只声明业务意图。

---

## 3. 高级模式

适合平台团队和关键工作流：

```typescript
kodax.run({
  input: task,
  serviceClass: "coding.deep",
  preferences: {
    deadlineMs: 120000,
    maxCost: 20,
    allowQueue: true,
    fallback: "quality-first"
  }
});
```

高级参数仍是偏好，不是绕过企业规则的权限。

---

# 七、端到端执行流程

```text
── Space / Runtime：确立上下文 ──
提交任务
  ↓
认证身份（SSO）
  ↓
绑定项目与应用上下文
  ↓
判定任务类型和数据等级（含 DLP 扫描）
  ↓
构建身份委托链
  ↓
组装并背书可信上下文
  ════════ 信任边界 ════════
── Fabric：施加约束 ──
  ↓
继承默认配置
  ↓
计算生效策略
  ↓
校验三种权利
  ↓
预测资源需求
  ↓
预占预算与容量
  ↓
生成候选产能源
  ↓
执行调度
  ↓
签发 Run Grant
  ════════ 返回 Runtime ════════
── Runtime：执行 ──
  ↓
运行 Agent（仅普通协议发往模型 Provider）
  ↓
运行与增量计量
  ↓
完成结算
  ↓
记录 Outcome
  ↓
更新质量和经济性画像
```

---

## 1. 身份解析

> **归属：KodaX Space / Runtime。**

Space / Runtime 验证：

- 用户身份；
    
- 应用身份；
    
- Agent 身份；
    
- 父级委托；
    
- 项目授权。
    

Runtime 生成不可伪造的 Principal Chain，作为可信上下文的一部分发给 Fabric。Fabric 信任并记录，不自行认证。

---

## 2. 编译 Run

> **归属：Fabric。** Space / Runtime 已经完成上下文编译，Fabric 在此基础上编译约束。

Fabric 的 Run Compiler 将可信上下文请求转换为 Compiled Run：

```text
Context-Attested Request（来自 Space / Runtime）
+ Defaults（组织默认值）
+ Policies（企业策略）
+ Entitlements（产能 + 预算授权）
= Compiled Run
```

---

## 3. 费用预测

预测内容包括：

- 输入 Token；
    
- 最大输出 Token；
    
- Reasoning 开销；
    
- 缓存命中概率；
    
- 工具调用；
    
- Agent 子任务；
    
- 重试风险；
    
- GPU 时间；
    
- 预计总成本。
    

费用预测不要求完全准确，而是用于确定安全的初始预占。

---

## 4. 预算预占

不建议一开始直接预占最大理论成本，否则会造成大量预算冻结。

采用两阶段方式：

### 初始预占

按照历史 P90 或预测执行阶段预占一笔合理额度。

### 增量扩展

运行过程中根据实际消费逐步追加预占。

```text
预计需要 8 元
先预占 10 元
执行至 7 元时预测还需 5 元
再申请追加 5 元
```

如果无法追加，则按照策略：

- 停止；
    
- 降级；
    
- 禁止新建子 Agent；
    
- 转入批处理；
    
- 从共享池借用；
    
- 请求审批。
    

---

## 5. Admission Control

Admission 先回答：

> 这个任务现在是否有资格开始？

检查：

- 权限；
    
- 数据政策；
    
- 预算；
    
- 并发；
    
- 保底和共享容量；
    
- 服务等级；
    
- 队列状态；
    
- 工具权限；
    
- Agent 上限。
    

结果可能是：

```text
Admitted
Queued
Approval Required
Degraded
Rejected
```

---

## 6. 候选过滤

调度器先移除不符合条件的候选：

```text
模型能力不足
上下文长度不足
数据区域不允许
供应商保留策略不合规
用户无访问权
产能池不可用
预算不足
质量低于下限
当前限流或故障
```

---

## 7. 调度评分

在合法候选中进行优化：

[  
Score_j =  
w_q Q_j

- w_c C_j
    
- w_l L_j
    

- w_u U_j
    
- w_e E_j
    
- w_r R_j  
    ]
    

其中：

- (Q_j)：任务成功率和质量预测；
    
- (C_j)：预计成本；
    
- (L_j)：延迟和违约风险；
    
- (U_j)：利用闲置产能的价值；
    
- (E_j)：消耗临期额度或合同承诺的价值；
    
- (R_j)：可靠性和健康状态。
    

例如：

### 交互式编码

更关注：

```text
首 Token 延迟
任务成功率
工具调用稳定性
```

### 夜间批处理

更关注：

```text
成本
闲置 GPU 利用率
临期额度
吞吐
```

---

## 8. 运行中控制

Fabric 持续监控：

- 当前成本；
    
- Token；
    
- Agent 迭代；
    
- 子 Agent 扩张；
    
- 重试；
    
- 工具调用；
    
- 延迟；
    
- 队列；
    
- 上游健康；
    
- 预算余量。
    

达到阈值时可以执行：

```text
模型降级
模型升级
停止生成
禁止新子任务
切换产能源
请求追加预算
暂停等待审批
保存状态后退出
```

---

## 9. 结算与对账

任务结束后：

- 释放未使用预占；
    
- 记录实际模型和工具成本；
    
- 记录自建 GPU 成本；
    
- 归因到团队、项目和 Run；
    
- 保留 Pricebook Version；
    
- 与供应商账单周期性核对。
    

上游实际账单晚到时，不修改原流水，而是通过 Adjustment 进行差额调整。

---

# 八、产能设计

## 1. 不使用单一 Capacity 数字

每个产能源维护一个多维容量向量：

```json
{
  "rpm_available": 1200,
  "input_tpm_available": 400000,
  "output_tpm_available": 120000,
  "concurrency_available": 45,
  "gpu_slots_available": 8,
  "queue_depth": 12,
  "balance_remaining": 32000,
  "days_to_expiry": 18,
  "health_confidence": 0.96
}
```

不同资源只需要上报适用的字段。

---

## 2. 产能分配类型

|类型|含义|
|---|---|
|Guaranteed|团队保底容量|
|Reserved|为活动、项目或时间窗口预留|
|Shared|符合条件的团队共同使用|
|Borrowed|从上级池或其他池借入|
|Lent|当前借给其他团队|
|Burst|短时间突破日常额度|
|Opportunistic|仅在资源闲置时使用|
|Emergency|事故和关键生产任务专用|
|Expiring|临近到期，调度权重提高|

---

## 3. 借用和召回

借用策略需要定义：

- 最大借入量；
    
- 最大借出量；
    
- 可借用的任务类型；
    
- 借用有效时间；
    
- 是否允许抢占；
    
- 原所有者需要容量时如何召回；
    
- 借用成本由谁承担；
    
- 哪些任务可以中止；
    
- 哪些任务只能自然完成。
    

建议规则：

- 交互式已运行任务默认不强制抢占；
    
- 批处理和可恢复任务可以被暂停或迁移；
    
- 被借出的保底容量在原所有者请求到来后逐步召回；
    
- 等待时间越长，任务优先级通过 Aging 提升；
    
- 任何团队都不能长期饥饿。
    

---

## 4. 自建与外部产能联动

典型策略：

```text
私有 GPU 队列低于阈值
→ 优先使用私有 GPU

私有 GPU 拥堵且数据允许外部处理
→ 溢出到企业外部 API Pool

外部预付额度即将过期
→ 对标准和批处理任务提高路由权重

生产关键任务
→ 使用预留低延迟 Capacity Pool
```

---

# 九、预算和账本设计

## 1. 四套账本

### 原生用量账

记录：

- 输入 Token；
    
- 输出 Token；
    
- Cached Token；
    
- Reasoning Token；
    
- 图片、音频和视频单位；
    
- GPU 秒；
    
- 请求数；
    
- 工具调用；
    
- Sandbox 时长。
    

### 容量账

记录：

- RPM、TPM；
    
- 并发；
    
- 队列；
    
- GPU 状态；
    
- 可用余额；
    
- 预留容量；
    
- 借入和借出；
    
- 到期时间。
    

### 经济账

记录：

- 外部 API 实际成本；
    
- 自建边际成本；
    
- 自建完全成本；
    
- 预付额度消耗；
    
- 固定合同分摊；
    
- 内部 AI Credit；
    
- 汇率；
    
- 税费；
    
- 预算转移和调整。
    

### 结果账

记录：

- 成功任务；
    
- 机器验证；
    
- 用户接受；
    
- Artifact 使用；
    
- PR 合并；
    
- 工单解决；
    
- 返工；
    
- 节省步骤和时间；
    
- 业务结果。
    

---

## 2. 自建资源的两种成本

### 实时调度使用边际成本

# [  
C_{marginal}

GPUSeconds \times VariableRate  
+  
Energy  
+  
Network  
]

> **完全成本（Fully-Loaded Cost）不属于 Fabric**：GPU 租赁分摊、闲置容量分摊、平台开销和运维是企业财务 / FinOps 部门的会计工作，需要对接固定资产台账和折旧政策。Fabric 只计算和记录边际成本（用于调度），并导出原始用量数据（GPU 秒、API 费用、请求数）供企业 FinOps 工具做完全成本分析。详见附录。

---

## 3. 账本模型

预算预占：

```text
可用预算账户    -10
预占账户        +10
```

实际消费 7 元：

```text
预占账户        -10
实际成本账户     +7
可用预算账户     +3
```

借用共享预算：

```text
团队共享池      -5
项目借入账户    +5
```

所有修改通过新增流水完成，不直接覆盖历史记录。

---

## 4. 软预算与硬预算

### Soft Limit

达到后：

- 提醒；
    
- 推荐降级；
    
- 需要说明；
    
- 降低默认模型等级；
    
- 限制新建子 Agent。
    

### Hard Limit

达到后：

- 停止；
    
- 排队；
    
- 申请审批；
    
- 使用紧急额度；
    
- 按策略完成当前步骤后终止。
    

---

# 十、Agent 原生治理

## 1. Agent 预算树

```text
用户 Run：20 元
├── Main Agent：13 元
│   ├── Scout Agent：2 元
│   ├── Implement Agent：8 元
│   └── Review Agent：2 元
├── Verifier：2 元
└── 工具与重试预留：5 元
```

子 Agent 使用的预算都属于父级 Run，不会独立突破总预算。

---

## 2. Agent 限制

每个 Run 可以配置：

- 最大迭代次数；
    
- 最大模型调用数；
    
- 最大子 Agent 数；
    
- 最大委托深度；
    
- 最大并发；
    
- 最大工具调用数；
    
- 最大执行时间；
    
- 最大上下文；
    
- 最大输出；
    
- 最大失败重试；
    
- 最大总成本。
    

这些通常来自 Workflow 和项目默认，不要求用户填写。

---

## 3. 工具权限

工具不仅有成本，也可能产生副作用。

工具分类：

|类型|示例|默认处理|
|---|---|---|
|Read Only|搜索、读仓库、查询数据库|在授权范围内自动执行|
|Reversible|创建草稿、生成分支|记录并允许回滚|
|Side Effect|发邮件、修改工单、部署|需要更强授权|
|High Risk|删除数据、生产发布、资金操作|人工审批或双重确认|

Run Grant 中明确工具 Scope，子 Agent 不能扩大。

---

## 4. 异常检测

重点监控：

### Retry Amplification

```text
实际模型调用次数 / 成功逻辑步骤数
```

### Loop Factor

```text
重复或近似步骤数 / 全部步骤数
```

### Context Redundancy

重复上下文占输入 Token 的比例。

### Child Expansion Factor

一个 Run 产生的子任务数量和深度。

### Unproductive Spend

失败、取消、未验证、未采用结果所产生的成本。

发现异常后可以：

- 暂停；
    
- 收紧预算；
    
- 禁止继续委托；
    
- 切换模型；
    
- 请求人工检查；
    
- 标记 Workflow 需要优化。
    

---

# 十一、策略系统

## 1. 策略层级

```text
法律与监管
    ↓
企业全局
    ↓
业务单元
    ↓
团队
    ↓
项目
    ↓
应用 / Workflow
    ↓
Run 偏好
```

低层级不能放宽上层硬规则。

---

## 2. 策略类别

### 模型策略

- 哪些模型可使用；
    
- 哪些版本已批准；
    
- 哪些模型只能测试；
    
- 模型退役日期；
    
- 哪些任务可以使用推理模型。
    

### 数据策略

- 数据等级；
    
- 是否允许外部发送；
    
- 允许区域；
    
- 是否需要脱敏；
    
- 是否允许保存正文；
    
- 是否允许用于模型训练。
    

### 预算策略

- 单次最大成本；
    
- 月度预算；
    
- 借用范围；
    
- 审批阈值；
    
- 紧急预算。
    

### Agent 策略

- 最大迭代；
    
- 子 Agent；
    
- 工具权限；
    
- 委托深度；
    
- 自动执行范围。
    

### 路由策略

- 成本优先；
    
- 质量优先；
    
- 延迟优先；
    
- 临期额度优先；
    
- 私有资源优先；
    
- Fallback 行为。
    

---

## 3. Decision Receipt：决策回执

每次 Run 生成可解释的决策回执：

```text
请求了哪个 Service Class
识别为何种任务
最终数据等级
适用了哪些策略
哪些模型被排除
为何选择当前产能源
预算从哪里预占
是否使用借入容量
是否发生降级
使用了哪个策略和路由版本
```

管理员可以对历史请求执行策略重放：

```text
如果使用新策略，这个 Run 会被如何处理？
```

---

# 十二、产品架构

```text
┌──────────────────────────────────────────────────────┐
│                  Experience Plane                    │
│ KodaX Space │ CLI │ SDK │ 第三方 Agent │ 企业应用     │
└──────────────────────┬───────────────────────────────┘
                       │ Run Request
                       ▼
┌──────────────────────────────────────────────────────┐
│                     Data Plane                       │
│ Identity Gateway → Run Compiler → Policy Enforcement│
│ → Admission → Scheduler → Adapter → Stream/Fallback │
└──────────────┬──────────────────────────┬────────────┘
               │                          │
               ▼                          ▼
┌────────────────────────────┐  ┌──────────────────────┐
│       Control Plane        │  │     Supply Plane     │
│ Org / Identity / Catalog   │  │ External Providers   │
│ Pool / Policy / Budget     │  │ Cloud Deployments    │
│ Route / Pricebook / Eval   │  │ Self-hosted Clusters │
└──────────────┬─────────────┘  │ Prepaid Credits      │
               │                └──────────┬───────────┘
               ▼                           │
┌──────────────────────────────────────────▼───────────┐
│              Telemetry & Economics Plane             │
│ Usage → Reservation → Settlement → Attribution      │
│ Trace → Run Graph → Evidence → Outcome               │
└──────────────────────┬───────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────┐
│                Intelligence Plane                    │
│ 需求预测 │ 成本预测 │ 质量预测 │ 异常检测 │ 路由优化 │
└──────────────────────────────────────────────────────┘
```

---

# 十三、产品模块

|模块|核心职责|
|---|---|
|**KodaX Access**|统一 API、协议适配、流式响应、Retry、Fallback、缓存|
|**KodaX Identity**|人、应用、Agent、工具身份及委托链|
|**KodaX Catalog**|模型、工具、能力、价格、合规和生命周期|
|**KodaX Capacity**|产能源、产能池、共享、借用、预留和健康状态|
|**KodaX Scheduler**|Admission、队列、公平调度、路由、抢占和溢出|
|**KodaX Ledger**|预算、预占、结算、Showback、Chargeback 和对账|
|**KodaX Govern**|Policy、数据治理、审批、DLP 和审计|
|**KodaX Observe**|Run Trace、Agent 树、成本、延迟和异常|
|**KodaX Outcome**|结果证据、成功率、接受率和业务影响|
|**KodaX Optimize**|成本、质量、容量和路由优化建议|

---

## Fabric 能力全景

> 本节在分层修正后，完整描述 Fabric 作为控制平面的全部能力。
>
> **Fabric 的输入**：Space / Runtime 背书的可信上下文请求（普通协议 + 企业上下文）。
>
> **Fabric 的输出**：Compiled Run + Run Grant + 执行计划 + 经济计量 + 决策回执。
>
> **Fabric 不做**：认证用户、判定数据等级、判定任务类型、构建委托链、组装执行上下文——这些归 Space / Runtime。

---

### A. 接入与协议适配

Fabric 提供统一入口，让所有 AI 调用经过一个可控通道。

- **原生 Run API**（`POST /v1/runs`）：接收 Service Class + 偏好，返回 Compiled Run + Run Grant + Decision Receipt。
- **兼容 API**：OpenAI-compatible、Anthropic-compatible——已有应用不必重写，`model` 字段映射为 Service Class（如 `kodax/coding-standard`）。
> **Fabric 只适配 LLM API 协议**（OpenAI / Anthropic / vLLM 等）。MCP 工具、A2A Agent、搜索 API、Sandbox 等非 LLM 资源由 Runtime 执行和适配；Runtime 调用后向 Fabric 报告用量，Fabric 负责成本归因。
- **协议适配**：将 Service Class 映射到具体模型和产能源。
- **流式响应、Retry、Fallback、缓存**。

**输入**：来自 Space / Runtime 的可信上下文请求（普通协议 + 企业上下文）。
**输出**：到实际模型 Provider 的仅普通协议请求（上下文已剥离）。

---

### B. 产能管理

Fabric 管理企业拥有的全部 AI 资源，将它们抽象为可分配、可计量、可调度的产能。

- **产能源注册与管理**：外部 Provider 账户、云部署、自建 vLLM / GPU 集群、预付额度、边缘模型。非 LLM 资源（搜索 API、MCP 服务、Sandbox）由 Runtime 管理，不纳入 Fabric 产能源——Runtime 报告用量，Fabric 记账归因。
- **产能池组织**：保底 / 共享 / 借用 / 预留 / 突发 / 临期 / 紧急。
- **多维容量向量**：RPM / TPM / 并发 / GPU slots / 队列深度 / 余额 / 到期天数 / 健康置信度——不同资源只需上报适用字段。
- **借用与召回**：最大借入/借出、可借用任务类型、抢占策略、Aging 优先级提升、原所有者召回规则。
- **自建与外部联动**：私有优先 → 拥堵溢出外部 → 临期额度提权 → 关键任务预留。

**输入**：产能源的实时健康和容量信号。
**输出**：产能池状态、可用容量向量、借用/召回决策。

---

### C. 调度与路由

Fabric 在合法候选中选择最优产能源，并管理排队和溢出。

- **Admission Control**：权限 / 数据政策 / 预算 / 并发 / 容量 / 服务等级 / 队列 / 工具权限 / Agent 上限 → Admitted / Queued / Approval Required / Degraded / Rejected。
- **候选过滤（硬约束）**：模型能力不足、上下文长度不足、数据区域不允许、供应商合规不通过、用户无访问权、产能池不可用、预算不足、质量低于下限、限流或故障——逐项移除。
- **调度评分**：`Score = w_q·Q + w_c·C + w_l·L + w_u·U + w_e·E + w_r·R`（质量 / 成本 / 延迟 / 闲置利用 / 临期额度 / 可靠性），权重随任务类型调整。
- **公平调度、队列管理、抢占、溢出**。
- **Route Studio**：可视化路由配置 + 模拟器 + Draft / Test / Shadow / Canary / Active / Rollback 全生命周期。

**输入**：生效策略 + 产能状态 + 预算授权。
**输出**：Execution Plan（用哪个池、哪个源、哪个模型版本、预占多少、是否排队、Fallback 顺序、是否允许升降级、最大执行时长）。

---

### D. 策略与治理

Fabric 接收 Space / Runtime 确立的上下文，计算并执行生效策略。

- **策略层级**：法律 → 企业 → BU → 团队 → 项目 → 应用 → Run，低层不能放宽上层硬规则。
- **Effective Policy 计算**：`Clamp(InheritedDefaults + UserHints, HardPolicies)`——允许模型取交集、禁止规则取并集、数据等级取更高、预算取更低、工具权限取交集、优先级不超授权、执行区域取政策允许交集、Agent 深度不超父级和项目限制。
- **策略类别**：模型策略（可用模型/版本/退役）、数据策略（等级/外部发送/区域/脱敏/保留/训练）、预算策略（单次/月度/借用/审批/紧急）、Agent 策略（迭代/子Agent/工具/委托深度/自动执行范围）、路由策略（成本/质量/延迟/临期/私有优先/Fallback）。
- **数据策略执行**：接收 Space / Runtime 判定的数据等级后执行（如"Confidential 禁止外部模型"、"必须脱敏"、"只能私有区域"）。Fabric 不判定数据等级，只执行基于等级的策略。
- **Decision Receipt**：每次 Run 生成可解释的决策回执——请求了哪个 Service Class、识别为何种任务、最终数据等级、适用了哪些策略、哪些模型被排除、为何选择当前产能源、预算从哪里预占、是否降级、使用了哪个策略和路由版本。
- **策略重放**：管理员可对历史请求执行"如果使用新策略，这个 Run 会被如何处理"。
- **审批工作流**。
- **审计**：策略决策、路由选择、预算预占、凭据使用、数据区域、模型/工具调用、人工审批、Outcome 修改、管理员配置变更——所有策略、Pricebook、路由版本不可变且可追溯。

**输入**：已认证 Principal + 项目绑定 + 数据等级 + 任务类型（来自 Space / Runtime）。
**输出**：Effective Policy + Decision Receipt + 审计记录。

---

### E. 预算与经济计量

Fabric 管理预算的全生命周期：预占 → 消费 → 结算 → 对账 → 归因。

- **Budget Waterfall**：项目专项 → 团队保底 → 团队共享 → BU 公共 → 企业公共 → 临时审批，自动选择预算来源，用户不需要指定从哪个账户扣款。
- **预算预占（两阶段）**：初始预占（历史 P90 或预测阶段）+ 增量扩展（运行中根据实际消费追加）。无法追加时按策略停止/降级/禁止新建子 Agent/转入批处理/从共享池借用/请求审批。
- **软预算 / 硬预算**：软预算达到后提醒/推荐降级/限制子 Agent；硬预算达到后停止/排队/审批/紧急额度/按策略完成当前步骤后终止。
- **四套账本**：
  - 原生用量账：输入/输出/Cached/Reasoning Token、图片音频视频单位、GPU 秒、请求数、工具调用、Sandbox 时长。
  - 容量账：RPM/TPM、并发、队列、GPU 状态、可用余额、预留容量、借入借出、到期时间。
  - 经济账：外部 API 实际成本、自建边际成本、自建完全成本、预付额度消耗、固定合同分摊、内部 AI Credit、汇率、税费、预算转移和调整。
  - 结果账：成功任务、机器验证、用户接受、Artifact 使用、PR 合并、工单解决、返工、节省步骤和时间、业务结果。
- **自建资源两种成本**：实时调度用边际成本（GPU 秒 × 变动费率 + 能耗 + 网络），财务分析用完全成本（边际 + 租赁分摊 + 闲置分摊 + 平台开销 + 运维）——避免"GPU 已购买所以内部模型成本为零"的错误判断。
- **结算与对账**：append-only 流水，所有修改通过新增流水完成，不覆盖历史。上游账单晚到时用 Adjustment 补差额，不改原流水。
- **Showback / Chargeback**：展示但不内部收费 / 按成本中心正式分摊。支持预算转移、临时追加、紧急预算、预付合同利用率。
- **Credential Broker**：Provider Key 只在 Secret Store / KMS / 企业 Vault / 客户本地 Credential Broker，自动轮换、紧急吊销、最小权限、区域隔离、仅内存短暂加载、不写日志和 Trace。

**输入**：成本中心（来自项目绑定）+ 实际用量信号。
**输出**：预算预占/释放、结算流水、成本归因（Run → 项目 → 团队）、对账记录。

---

### F. 授权

Fabric 签发短期执行授权，确保权限不扩大。

- **Run Grant 签发**：包含 Principal、Run ID、允许的 Service Class、最大预算、允许模型和工具、数据等级、最大委托深度、最大 Agent 数、有效期、父级 Run、Policy Version。
- **子 Grant ⊆ 父 Grant**：子 Agent 获得父级权限的子集，不能自行扩大权限。
- **Principal 类型管理**：Human User / Service Account / Application / Workflow / Agent / Child Agent / Tool / 外部 A2A Agent。

> **注意**：Fabric 不认证用户——认证由 Space 完成，委托链由 Runtime 构建。Fabric 接收 Space / Runtime 背书的 Principal Chain，在此之上签发 Run Grant。

---

### G. 可观测性

Fabric 提供从 Run 到 Outcome 的全链路可观测性。

- **Run Trace**：Run → Agent → 子 Agent → 模型调用 → 工具调用 → Artifact → Outcome 全链路追踪。
- **Agent 树可视化**。
- **成本瀑布**：每个 Main Agent / Scout / Implement / Review / Verifier / 工具 / 重试的成本归因。
- **延迟瀑布**、**预算变化追踪**、**模型切换和 Fallback 记录**。
- **异常检测**：
  - Retry Amplification（实际模型调用次数 / 成功逻辑步骤数）
  - Loop Factor（重复或近似步骤数 / 全部步骤数）
  - Context Redundancy（重复上下文 / 输入 Token）
  - Child Expansion Factor（子任务数量和深度）
  - Unproductive Spend（失败、取消、未验证、未采用结果的成本）
- **关键事件链**：run.requested → run.compiled → policy.evaluated → run.admitted → reservation.created → route.decided → usage.metered → budget.threshold_reached → agent.delegated → tool.executed → reservation.settled → outcome.recorded → run.completed。每个事件携带 Tenant、Principal Chain、Project、Run、Step、Agent、Logical Call ID、Attempt ID、Provider、Model、Capacity Source、Policy Version、Route Version、Pricebook Version、Idempotency Key。
- **错误模型**：不返回抽象 429，而是返回 `policy_denied` / `budget_unavailable` / `capacity_unavailable` / `approval_required` / `data_region_unavailable` / `service_class_unavailable` / `agent_limit_reached` / `tool_not_authorized` / `upstream_failed`，并附带可操作信息。

**输入**：Runtime 的执行事实（Run Graph、Agent 树、模型调用、工具调用）。
**输出**：Run Explorer 视图、异常告警、优化建议。

---

### H. 结果与智能优化

Fabric 追踪结果质量，并在安全边界内给出优化建议。

- **Outcome 四级**：L0 交付（模型正常返回）→ L1 机器验证（测试通过、格式正确）→ L2 用户采纳（用户采用代码或文档）→ L3 业务影响（PR 合并、工单解决、流程完成）。
- **Outcome Evidence 接收与分析**：Fabric 接收 Runtime / Space 报告的 Evidence（测试结果、用户确认、Artifact 使用、PR 合并、工单状态、业务回调、Verifier 评分），做跨 Run 聚合分析。Fabric 不直接对接外部系统采集 Evidence。
- **质量画像**：模型 × 版本 × 任务类型 × 项目类型 × 上下文规模 × Workflow × 工具组合 → 完成率 / 验证通过率 / 掻受率 / 返工率 / 平均重试 / 平均成本 / 平均完成时间。
- **路由学习**：离线评测 → Shadow → Canary → 受控发布 → 持续监控 → 自动或人工回滚。系统逐渐学习"某类简单 CI 错误用标准模型已足够"、"大型仓库重构需要深度模型才更经济"。
- **优化建议**：
  - 用户级：切换更适合的模式、减少重复上下文、适合低峰批处理。
  - Workflow 级：重试策略过于激进、子 Agent 数量过多、Verifier 成本高但收益有限、某步骤可缓存。
  - 平台级：某产能池持续闲置、预付额度可能无法用完、某团队保底容量长期过高、某模型在特定任务上单位结果成本过高。
- **北极星指标**：`Accepted Outcomes / Fully Loaded AI Cost`——每单位完全 AI 成本产生的被接受有效结果。

> **Intelligence Plane 不直接突破策略**，而是在安全边界内给出建议和优化。安全、数据、合规和预算硬限制不交给 LLM 自由判断。

---

### I. 安全

- **上游凭据不下发**：Provider Key 只存储在 Secret Store / KMS / 企业 Vault / 客户本地 Credential Broker。用户和 Agent 使用短期 Run Grant，不直接接触上游凭据。
- **Credential Broker**：根据 Run Grant + Route Decision + Capacity Source + Credential Scope 动态选择凭据。自动轮换、紧急吊销、最小权限、区域隔离、使用审计、仅内存短暂加载、不写日志和 Trace。
- **数据保存模式**：Full / Redacted / Metadata Only / Zero Retention / Local Only——项目管理员配置默认，Run 只能选同等或更严格。
- **防御性深度扫描（可选）**：Fabric 可在收到数据等级后二次扫描，但只能升级不能降级，作为安全网而非主判定。
- **版本不可变**：所有策略、Pricebook、路由版本不可变且可追溯。

---

### J. 部署与可靠性

**部署模式：**

- **SaaS 控制面 + 客户数据面**：KodaX SaaS 管组织配置/目录/策略/聚合分析，客户环境管 Gateway/Credential/请求正文/实时执行。适合多数企业。
- **全私有部署**：控制面、数据面、账本和分析全部在客户环境。
- **Air-Gapped**：离线策略包/目录/身份/账本/价格/许可证，无公网 Provider。
- **多区域联邦**：Global Control Plane + China / Europe / North America / On-Premise Data Plane。正文和凭据留在区域内，全局只同步允许聚合的数据。

**可靠性目标：**

| 能力 | 目标 |
|---|---|
| 数据面可用性 | 99.99% |
| 控制面可用性 | 99.9%+ |
| 缓存策略下额外路由延迟 | P95 几十毫秒内 |
| 预算预占 | 强一致 |
| 账本流水 | 不丢失、可幂等 |
| 策略发布 | 版本化、可回滚 |
| 容量信号 | 秒级刷新 |
| 使用分析 | 最终一致 |
| 财务对账 | 周期性校准 |

**控制面故障处理**：数据面缓存签名策略快照、路由快照、模型目录、Pricebook、身份公钥、本地预算窗口、应急模式。不同项目可配置 Fail Closed / 使用缓存策略继续 / 仅允许私有模型 / 仅允许已预留任务 / 使用应急预算。

**幂等性**：每个逻辑调用区分 Logical Call → Attempt 1/2/3。业务结果只完成一次，但所有重试成本都计入经济账——既避免重复业务操作，也不隐藏重试产生的真实成本。

---

### K. Token ROI 分析

> 当前北极星指标 `Accepted Outcomes / Fully Loaded AI Cost` 的成本侧仍是一个总额。Token ROI 分析将每一枚 Token 拆到**类型级别**，回答"这笔钱花在刀刃上了吗"。

---

#### 1. Token 分类体系

**输入 Token 分类：**

| 类型 | 说明 | 价值特征 | 缓存潜力 |
|---|---|---|---|
| 系统提示 (System Prompt) | 角色定义、规则、工具定义 | 固定开销，每次请求重复 | 高（可缓存，命中后成本极低） |
| 用户查询 (User Query) | 用户的实际任务输入 | 核心价值，不可省 | 低（每次不同） |
| 上下文/历史 (Context) | 对话历史、之前步骤的结果 | 边际价值递减 | 中（会话内可缓存） |
| 工具调用结果 (Tool Result) | 工具返回的数据注入上下文 | 取决于是否被后续步骤引用 | 低 |
| 文件/仓库内容 (Injected Content) | 注入的代码、文档、知识库 | 取决于与任务的相关性 | 中（可缓存） |

**输出 Token 分类：**

| 类型 | 说明 | 价值特征 |
|---|---|---|
| 正式输出 (Final Output) | 最终回答 / 代码 / 文档 / 方案 | 核心价值产出 |
| 工具调用 (Tool Call) | 发起的工具请求 | 手段性产出，价值取决于工具结果是否被使用 |
| 思维链/推理 (Thinking / Reasoning) | 模型的内部推理过程 | 开销性产出，影响质量但不直接交付 |
| 结构化数据 (Structured Output) | JSON / 表格 / 指令 | 中等价值，取决于消费方是否使用 |

**缓存维度（叠加在输入 Token 上）：**

| 缓存状态 | 成本因子 | 说明 |
|---|---|---|
| 命中缓存 | 0.1× | 如 Anthropic prompt caching、OpenAI cached tokens，成本极低 |
| 未命中 | 1.0× | 正常计费 |

---

#### 2. Token 效率分解

把一个 Run 的所有 Token 按类型拆开，看成本分布和浪费点：

```text
Run：修复支付服务 CI
总成本：¥6.73

输入侧：
  系统提示      2,000 tokens  ¥0.50 (7.4%)   缓存命中 80% → 实际 ¥0.12
  用户查询        100 tokens  ¥0.02 (0.3%)
  上下文/历史   4,000 tokens  ¥1.20 (17.8%)
  工具结果      2,000 tokens  ¥0.80 (11.9%)  其中 600 tokens 未被引用 → 浪费 ¥0.24
  文件/仓库     3,000 tokens  ¥0.60 (8.9%)

输出侧：
  思维链        3,000 tokens  ¥1.50 (22.3%)
  工具调用        500 tokens  ¥0.25 (3.7%)
  正式输出      2,000 tokens  ¥1.76 (26.2%)
```

管理者和开发者一眼能看到：
- 22.3% 花在思维链上——值不值？
- 11.9% 花在工具结果上，其中 30% 未被引用——那是浪费；
- 系统提示占 7.4%，但缓存命中后实际只花 1.8%——缓存策略有效。

---

#### 3. Token ROI 算法

**核心公式：**

```text
TokenROI = OutcomeValue / WeightedTokenCost
```

**WeightedTokenCost（加权 Token 成本）：**

```text
WeightedTokenCost = Σ(input_count × type_weight × cache_factor × unit_price)
                  + Σ(output_count × type_weight × unit_price)
```

**type_weight（价值权重——反映该类 Token 对结果的贡献度）：**

| Token 类型 | 权重 | 理由 |
|---|---|---|
| 输入 - 系统提示 | 0.3 | 固定开销，不是核心价值 |
| 输入 - 用户查询 | 1.0 | 核心输入，不可省 |
| 输入 - 上下文/历史 | 0.5 | 边际递减，多了不一定有用 |
| 输入 - 工具结果 | 0.2 | 大多未被充分引用 |
| 输入 - 文件/仓库 | 0.4 | 相关性不确定 |
| 输出 - 正式输出 | 1.0 | 核心产出 |
| 输出 - 工具调用 | 0.5 | 手段性，不直接交付 |
| 输出 - 思维链 | 0.3 | 开销性，不直接交付 |
| 输出 - 结构化数据 | 0.6 | 取决于消费方 |

**cache_factor（缓存因子）：**

| 缓存状态 | 因子 |
|---|---|
| 命中缓存 | 0.1 |
| 未命中 | 1.0 |

**OutcomeValue（结果价值）：**

| Outcome 级别 | 价值系数 |
|---|---|
| L0 交付 | 1× |
| L1 机器验证 | 3× |
| L2 用户采纳 | 8× |
| L3 业务影响 | 20× |
| 被拒绝 / 废弃 | 0× |

---

#### 4. 示例

```text
Run A（成功，L2 采纳）:
  WeightedTokenCost = ¥4.20（加权后低于原始 ¥6.73，因为缓存和低权重类型拉低）
  OutcomeValue = 8
  TokenROI = 8 / 4.20 = 1.90

Run B（失败，L0 仅交付，结果被拒绝）:
  WeightedTokenCost = ¥5.80
  OutcomeValue = 0
  TokenROI = 0 / 5.80 = 0.00
```

Run A 的每一元加权 Token 成本换来了 1.90 的结果价值；Run B 完全浪费。

---

#### 5. 应用场景

| 场景 | 问题 | Token ROI 分析的回答 |
|---|---|---|
| 模型对比 | 同一任务，模型 A 思维链占 30% 但成功率高，模型 B 思维链占 10% 但返工率高——哪个更值？ | 分别计算 TokenROI，直接比较 |
| Workflow 优化 | 某步工具结果 60% 未被引用 | 标记为浪费，建议裁剪上下文，预计省 15% 输入成本 |
| 缓存策略 | 系统提示占 7.4% 但缓存后实际 1.8% | 缓存有效，建议推广到其他 Workflow |
| 废弃检测 | ROI = 0 的 Run 占比 | 直接关联无效消耗比例和北极星指标 |
| 上下文冗余 | 上下文/历史占 17.8%，但多少是重复？ | 结合 Context Redundancy 异常检测，量化冗余成本 |
| Agent 扩张 | 子 Agent 的 Token ROI 是否递减？ | 按委托深度聚合 ROI，判断子 Agent 扩张是否值得 |

---

#### 6. 与现有指标的关系

Token ROI 不是替代北极星指标，而是**拆解成本侧**的工具：

```text
北极星：Accepted Outcomes / Fully Loaded AI Cost
                                    ↑
                          这个"Cost"目前是一个总额
                                    ↑
                    Token ROI 把它拆成类型级别的加权成本
                    + 量化每类 Token 的效率和浪费
```

Fabric 的 Run Explorer 在展示成本瀑布时，除了按 Agent / 工具 / Verifier 拆分，还应增加**按 Token 类型拆分**的视图，让管理者和开发者看到"钱具体花在了什么类型的 Token 上，其中多少是浪费"。

---

#### 7. 文件级成本归因

> **Fabric 能独立完成（解析 LLM 工具调用输出）。这是三层 ROI 的甜区。**

在工具调用范式下，LLM 修改文件的标准方式是生成结构化工具调用（edit、write、read），工具调用参数中包含文件路径。Fabric 作为网关能看到 LLM 的完整响应，可以直接解析工具调用提取文件路径，按文件归因 Token 成本。

**Fabric 能解析的（网关路径，自动）：**

- 工具名称（edit / write / read / bash）
- 文件路径（从工具调用参数 JSON 中提取）
- 操作类型（读 / 写 / 编辑 / 删除）
- Token 成本（网关计量）
- 同一文件的多次编辑（重试检测）

**Fabric 需要 Runtime 补充的：**

- 工具调用执行结果（成功 / 失败）
- 文件最终是否被用户采纳（Space 报告）

**示例：**

```text
Run：修复支付服务 CI
总成本：¥6.73

文件级归因：
  src/auth/login.py     ¥2.40 (35.7%)  — 3 次 edit（2 次重试），最终成功
  src/auth/utils.py     ¥1.80 (26.8%)  — 1 次 edit，成功
  tests/test_login.py   ¥1.53 (22.7%)  — 1 次 write，成功
  （推理/分析）          ¥1.00 (14.8%)  — 读文件后的分析，未产生修改
```

> **限制**：仅适用于工具调用范式的交互。如果 LLM 生成纯文本代码（无工具调用），Fabric 无法确定文件路径——需要 Runtime 报告文件映射。工具调用结构是元数据而非内容，在 Metadata Only / Zero Retention 数据模式下仍可解析。

---

#### 8. Artifact ROI 分析

> **依赖 Runtime 打指纹，Fabric 做跨 Run 分析。Fabric 不能独立完成。**

Fabric 只能看到 LLM 的原始输出文本，不是最终 Artifact。Artifact 是 Agent 加工后的产物（文件、PR、文档），中间有 Agent 的加工。且在非 Full 数据保存模式下，Fabric 连 LLM 输出内容都看不到。

**指纹生成是 Runtime 的职责**——Runtime 始终有 Artifact 内容，不受数据保存模式限制。hash 不泄露内容（不可逆），跨数据模式都安全。

**职责分工：**

| 职责 | 谁做 | 为什么 |
|---|---|---|
| 打指纹（hash 内容） | Runtime | Runtime 始终有 Artifact 内容 |
| 去重检测 | Fabric | Fabric 有跨 Run 全局视角 |
| 采纳率/复用率统计 | Fabric | 需要跨 Run 聚合 |
| Artifact ROI 计算 | Fabric | Fabric 有成本数据 + 采纳数据 |

**前提条件**：Artifact 指纹分析依赖 Runtime 主动声明 Artifact 并报告指纹。如果 Runtime 不声明，Fabric 无法做 Artifact 级分析——只能退回到文件级（解析工具调用）或 Token 级。

**示例（同样的 Token 量，ROI 差 8 倍）：**

```text
场景 A（反复生成同一文档）:
  10 次尝试，每次生成同一个 500 token 文档
  1 个被采纳，9 个重复
  ArtifactROI = (1 × 0.7) / cost = 低

场景 B（生成多个不同文档）:
  10 次尝试，每次生成不同的 500 token 文档
  8 个被采纳
  ArtifactROI = (8 × 0.7) / cost = 高 8 倍
```

---

#### 9. 三层 ROI 体系

| 层级 | Fabric 能独立做吗 | 粒度 | 依赖 |
|---|---|---|---|
| **Token 级 ROI** | ✅ 能 | 每类 Token 的成本和效率 | Fabric 网关自身 |
| **文件级 ROI** | ✅ 能（成本归因）+ Runtime 补充（执行结果） | 每个文件的成本、重试次数、操作链路 | Fabric 解析工具调用；Runtime 报告执行结果 |
| **Artifact 级 ROI** | ❌ 不能独立做 | Artifact 去重、多样性、采纳率、复用率 | Runtime 打指纹 + 报告；Fabric 做跨 Run 分析 |

**文件级是甜区**——比 Token 级更 actionable（开发者知道哪个文件花了多少钱），比 Artifact 级更可行（不需要 Runtime 打指纹，Fabric 解析工具调用即可）。
---

# 十四、管理控制台信息架构

```text
Overview
Capacity
Models & Services
Routes
Budgets
Runs
Outcomes
Governance
Integrations
Settings
```

---

## 1. Overview：AI Command Center

首页回答：

> 企业 AI 运行是否健康、经济、有效、可控？

核心指标：

```text
有效 Outcome 数
每个有效 Outcome 成本
预算消耗与预测
已购产能利用率
私有 GPU 利用率
临期额度
无效消耗
异常 Agent
策略违规
关键任务 SLO
```

首页不应把“总 Token”作为第一指标。

---

## 2. Capacity Map

展示：

```text
Provider / 数据中心
        ↓
账户 / 集群 / Deployment
        ↓
Capacity Pool
        ↓
团队 / 项目
```

状态：

- 健康；
    
- 拥堵；
    
- 闲置；
    
- 临近限流；
    
- 临近到期；
    
- 合同使用不足；
    
- 故障；
    
- 受数据政策限制。
    

---

## 3. Pool Detail

页面内容：

```text
总容量
已用
保底
共享
预留
借入
借出
等待队列
按团队分布
按 Service Class 分布
预计未来 7/30 天需求
```

管理员可以设置：

- 保底额度；
    
- 最大借入；
    
- 最大借出；
    
- 可使用团队；
    
- 召回策略；
    
- 任务优先级；
    
- 允许的数据等级。
    

---

## 4. Model & Service Catalog

分为两层：

### 模型层

显示：

- Provider；
    
- 模型版本；
    
- 能力；
    
- 价格；
    
- 质量；
    
- 延迟；
    
- 数据政策；
    
- 区域；
    
- 生命周期。
    

### Service Class 层

显示：

```text
coding.standard
当前候选模型
质量下限
延迟目标
允许区域
默认 Fallback
当前版本
Canary 比例
```

---

## 5. Route Studio

管理员以可视化方式配置：

```text
任务条件
→ 硬约束
→ 候选模型
→ 优化目标
→ Fallback
→ 无候选时行为
```

必须提供模拟器：

```text
输入：
用户、项目、任务、数据等级、预算、时间

输出：
最终 Service Class
候选过滤结果
选中产能源
预计成本
适用策略
```

路由变更支持：

- Draft；
    
- Test；
    
- Shadow；
    
- Canary；
    
- Active；
    
- Rollback。
    

---

## 6. Budget Center

展示：

```text
组织预算树
项目和团队余额
预算预测
借入和借出
软硬阈值
审批记录
未归因成本
预占余额
实际结算
```

支持：

- Showback：展示但不内部收费；
    
- Chargeback：按成本中心正式分摊；
    
- 预算转移；
    
- 临时追加；
    
- 紧急预算；
    
- 预付合同利用率。
    

---

## 7. Run Explorer

这是 KodaX 的核心差异化页面。

```text
Run：修复支付服务 CI
总成本：¥6.73
状态：已完成
Outcome：测试通过，用户接受

Main Agent                       ¥4.60
├── Context Analysis             ¥0.72
├── Scout Agent                  ¥0.81
├── Implementation Agent         ¥2.34
└── Review Agent                 ¥0.73

Tools                            ¥0.87
├── Repository Search            ¥0.04
├── Test Sandbox                 ¥0.62
└── Git Operations               ¥0.21

Verifier                         ¥0.48
Retry / Wasted Cost              ¥0.78
```

同时显示：

- Agent 树；
    
- 模型调用；
    
- Token；
    
- 工具调用；
    
- 延迟瀑布；
    
- 预算变化；
    
- 模型切换；
    
- Fallback；
    
- 策略决策；
    
- Outcome Evidence；
    
- 优化建议。
    

---

## 8. Outcome Lab

用于比较：

```text
任务类型 × 模型 × Workflow × 成本 × 结果
```

指标：

- 成功率；
    
- 验证通过率；
    
- 用户接受率；
    
- 返工率；
    
- 每个 Outcome 成本；
    
- 模型升级收益；
    
- 模型降级损失；
    
- Workflow 无效步骤；
    
- Agent 循环成本。
    

---

# 十五、KodaX Space 用户体验

## 1. 发起任务

默认界面：

```text
┌─────────────────────────────────────────┐
│ 修复当前项目中的登录失败问题             │
│                                         │
│ 模式：[标准 ▼]   隐私：[遵循项目策略]     │
│                                         │
│                           [开始执行]      │
└─────────────────────────────────────────┘
```

普通用户只需要理解：

- 快速；
    
- 标准；
    
- 深度；
    
- 私有。
    

真实模型名称可以隐藏。

---

## 2. 运行前提示

仅在必要时展示：

```text
预计模式：标准
预算来源：支付研发团队
预计成本：¥2–¥5
数据处理：企业私有环境
预计等待：无需排队
```

不是每次都要求用户确认。

---

## 3. 运行中

```text
任务进度：正在验证修复
预算：¥3.8 / ¥8.0
服务等级：Coding Standard
子 Agent：2 / 4
状态：正常
```

模型切换时显示面向用户的解释：

```text
私有集群当前拥堵，任务已进入低延迟备用产能。
数据仍保持在企业允许区域内。
```

---

## 4. 接近预算

```text
当前任务已使用 80% 预算。

继续当前模式
预计增加 ¥3–¥5

切换标准模式
预计增加 ¥1–¥2

停止并保存当前结果

申请团队共享额度
```

系统可以根据策略默认选择，但涉及明显提额时应让用户理解。

---

## 5. 完成页

```text
结果：已完成
验证：12 项测试全部通过
总成本：¥6.73
共享容量：未使用
模型切换：1 次
无效重试成本：¥0.38
生成 Artifact：补丁、测试报告

建议：
当前仓库上下文存在重复传入，可预计减少约 15% 输入消耗。
```

不展示个人 Token 排名，不将个人成本直接等同于绩效。

---

# 十六、开发者 API

## 1. 原生 Run API

```http
POST /v1/runs
```

```json
{
  "input": "修复当前 CI 失败",
  "service_class": "coding.standard",
  "project_id": "payment-service",
  "preferences": {
    "allow_queue": true,
    "max_cost": 20
  }
}
```

响应：

```json
{
  "run_id": "run_01JXYZ",
  "status": "admitted",
  "effective_service_class": "coding.standard@v7",
  "budget": {
    "reserved": 12,
    "currency": "CNY",
    "funding_source": "payment-rd-shared"
  },
  "execution": {
    "privacy_mode": "private",
    "queue": "interactive-coding",
    "route_visibility": "abstract"
  },
  "decision_receipt_id": "decision_01JXYZ"
}
```

---

## 2. 兼容 API

Fabric 同时提供兼容接口，让已有应用不必重写。

例如：

```text
OpenAI-compatible
Anthropic-compatible
KodaX Native SDK
```

兼容请求中的 `model` 可以映射为 Service Class：

```text
model = kodax/coding-standard
```

SDK 自动注入项目和身份上下文。

---

## 3. 关键事件

```text
run.requested
run.compiled
policy.evaluated
run.admitted
reservation.created
run.queued
route.decided
attempt.started
usage.metered
budget.threshold_reached
route.fallback
agent.delegated
tool.executed
attempt.completed
reservation.settled
outcome.recorded
run.completed
```

事件必须带有：

- Tenant；
    
- Principal Chain；
    
- Project；
    
- Run；
    
- Step；
    
- Agent；
    
- Logical Call ID；
    
- Attempt ID；
    
- Provider；
    
- Model；
    
- Capacity Source；
    
- Policy Version；
    
- Route Version；
    
- Pricebook Version；
    
- Idempotency Key。
    

---

## 4. 错误模型

系统不要只返回一个抽象的 `429`。

标准错误包括：

```text
policy_denied
budget_unavailable
capacity_unavailable
approval_required
data_region_unavailable
service_class_unavailable
agent_limit_reached
tool_not_authorized
upstream_failed
```

同时返回可操作信息：

```json
{
  "code": "budget_unavailable",
  "message": "项目预算不足以执行 Coding Deep。",
  "available_actions": [
    "use_coding_standard",
    "request_shared_budget",
    "queue_for_next_cycle"
  ]
}
```

---

# 十七、安全设计

## 1. 上游凭据不下发

Provider Key 只存储在：

- Secret Store；
    
- KMS；
    
- 企业 Vault；
    
- 客户本地 Credential Broker。
    

用户和 Agent 使用短期 Run Grant，不直接接触上游凭据。

---

## 2. Credential Broker

根据以下信息动态选择凭据：

```text
Run Grant
+ Route Decision
+ Capacity Source
+ Credential Scope
```

要求：

- 自动轮换；
    
- 紧急吊销；
    
- 最小权限；
    
- 区域隔离；
    
- 使用审计；
    
- 仅在内存中短暂加载；
    
- 不写入日志和 Trace。
    

---

## 3. 数据保存模式

|模式|保存内容|
|---|---|
|Full|保存经过授权的请求和响应|
|Redacted|保存脱敏后的内容|
|Metadata Only|仅保存成本、Token、延迟和状态|
|Zero Retention|不持久保存正文|
|Local Only|正文只保存在客户环境|

项目管理员配置默认模式，Run 只能选择同等或更严格模式。

---

## 4. 审计

审计对象包括：

- 身份和委托链；
    
- 策略决策；
    
- 路由选择；
    
- 预算预占；
    
- 凭据使用；
    
- 数据区域；
    
- 模型和工具调用；
    
- 人工审批；
    
- Outcome 修改；
    
- 管理员配置变更。
    

所有策略、Pricebook 和路由版本不可变且可追溯。

---

# 十八、部署设计

## 1. SaaS 控制面 + 客户数据面

```text
KodaX SaaS：
组织配置、目录、策略管理、聚合分析

客户环境：
Gateway、Credential、请求正文、实时执行
```

适合多数企业。

---

## 2. 全私有部署

控制面、数据面、账本和分析全部部署在客户环境。

---

## 3. Air-Gapped

支持：

- 离线策略包；
    
- 离线模型目录；
    
- 本地身份；
    
- 本地账本；
    
- 手工导入价格和许可证；
    
- 无公网 Provider。
    

---

## 4. 多区域联邦

```text
Global Control Plane
├── China Data Plane
├── Europe Data Plane
├── North America Data Plane
└── On-Premise Data Plane
```

正文和凭据留在区域内，全局只同步允许聚合的数据。

---

# 十九、可靠性和一致性

## 1. 建议服务目标

|能力|建议目标|
|---|---|
|数据面可用性|99.99%|
|控制面可用性|99.9% 以上|
|缓存策略下额外路由延迟|P95 控制在几十毫秒内|
|预算预占|强一致|
|账本流水|不丢失、可幂等|
|策略发布|版本化、可回滚|
|容量信号|秒级刷新|
|使用分析|最终一致|
|财务对账|周期性校准|

---

## 2. 控制面故障

数据面缓存：

- 签名策略快照；
    
- 路由快照；
    
- 模型目录；
    
- Pricebook；
    
- 身份公钥；
    
- 本地预算窗口；
    
- 应急模式。
    

不同项目可配置：

```text
Fail Closed
使用缓存策略继续
仅允许私有模型
仅允许已预留任务
使用应急预算
```

---

## 3. 幂等性

每个逻辑调用区分：

```text
Logical Call
└── Attempt 1
└── Attempt 2
└── Attempt 3
```

业务结果只完成一次，但所有重试成本都计入经济账。

这既避免重复业务操作，也不会隐藏重试产生的真实成本。

---

# 二十、智能优化设计

Intelligence Plane 不直接突破策略，而是在安全边界内给出建议和优化。

## 1. 质量画像

按照以下维度统计模型表现：

```text
模型
× 模型版本
× 任务类型
× 项目类型
× 上下文规模
× Workflow
× 工具组合
```

指标：

- 完成率；
    
- 验证通过率；
    
- 接受率；
    
- 返工率；
    
- 平均重试；
    
- 平均成本；
    
- 平均完成时间。
    

---

## 2. 路由学习

系统可以逐渐学习：

```text
某类简单 CI 错误使用标准模型已足够
大型仓库重构需要深度模型才更经济
特定模型生成代码便宜但返工率过高
某个私有模型在文档摘要任务上利用率和质量都更优
```

自动路由变更必须经过：

```text
离线评测
→ Shadow
→ Canary
→ 受控发布
→ 持续监控
→ 自动或人工回滚
```

---

## 3. 优化建议

建议分为：

### 用户级

- 当前任务可以切换更适合的模式；
    
- 上下文存在大量重复；
    
- 任务适合低峰批处理。
    

### Workflow 级

- 重试策略过于激进；
    
- 子 Agent 数量过多；
    
- Verifier 成本高但收益有限；
    
- 某一步骤可以缓存。
    

### 平台级

- 某产能池持续闲置；
    
- 预付额度可能无法用完；
    
- 某团队保底容量长期过高；
    
- 某模型在特定任务上单位结果成本过高。
    

---

# 二十一、核心指标

## 北极星指标

[  
\frac{Accepted\ Outcomes}  
{Fully\ Loaded\ AI\ Cost}  
]

即：

> 每单位完全 AI 成本产生的被接受有效结果。

---

## 产能指标

- 已购容量利用率；
    
- 自建 GPU 有效利用率；
    
- 闲置容量回收率；
    
- 临期额度使用率；
    
- 借用容量比例；
    
- 资源饥饿率；
    
- 高峰需求满足率。
    

---

## 经济指标

- 每个成功 Run 成本；
    
- 每个被接受 Outcome 成本；
    
- 无效消耗比例；
    
- 重试成本比例；
    
- 预算预测误差；
    
- 未归因成本；
    
- 自建与外部单位结果成本。
    

---

## 质量指标

- Run 完成率；
    
- 自动验证通过率；
    
- 用户接受率；
    
- 返工率；
    
- 模型降级质量损失；
    
- 模型升级收益。
    

---

## 体验指标

- P95 首 Token 延迟；
    
- P95 Run 完成时间；
    
- 排队时间；
    
- 预算中断率；
    
- 审批等待时间；
    
- 用户手动选择具体模型比例。
    

最后一个指标越低，说明 Service Class 和自动调度越成熟。

---

## 治理指标

- 统一入口覆盖率；
    
- 未授权模型调用；
    
- 敏感数据错误路由；
    
- Provider Key 暴露事件；
    
- 决策可重放率；
    
- Agent 异常循环发现率。
    

---

# 二十二、与 KodaX 和 KodaX Space 的关系

## 1. Fabric 是体内特殊 Provider

对于 KodaX 和 KodaX Space 来说，KodaX Fabric 是一个**体内特殊的 Provider**。

从 Runtime 的视角看，Fabric 长得像一个 Provider——你向它发请求，它返回响应。但它特殊在两点：

1. **体内**：它不是外部服务，它在 KodaX 的信任边界之内。

2. **只有 Fabric 会收到"普通协议之外"的信息**：普通协议是 `{messages, model, temperature, tools, ...}`。但向 Fabric 发请求时，你额外附上可信上下文——身份、项目绑定、数据等级、委托链、预算偏好。**这些信息不会发给任何其他 Provider。** 外部模型 Provider 只收到普通协议，企业上下文在到达它们之前被剥离。

这使得 Fabric 成为**信任边界**——企业上下文进入的入口，也是它不外泄的闸门。

```text
Space / Runtime → Fabric：普通协议 + 可信上下文（who / project / data level / delegation）
Fabric → 实际模型 Provider：仅普通协议（prompt / messages，上下文已剥离）
```

---

## 2. 上下文确立 vs 约束施加

三层之间的职责分界基于一个原则：**谁天然拥有什么信息。**

- **KodaX Space / Runtime**（执行层）：用户在这里登录、打开项目、读写文件、运行 Agent。"谁、在哪个项目、处理什么数据"——这些信息天然存在于执行层。
- **KodaX Fabric**（控制平面）：不在执行路径上，是旁路的治理与经济层。天然知道的是：企业有哪些 AI 资源、什么策略允许、哪个预算有钱、哪个产能池空闲。

> **执行层负责"确立上下文"（who / what / where），Fabric 负责"施加约束"（with what resources / under what rules / at what cost）。**
>
> **Fabric 是上下文的消费者，不是生产者。**

---

## 3. 职责分层

| 职责 | 归属 | 说明 |
|---|---|---|
| 用户认证（SSO） | Space | 用户在 Space 登录，Space 持有会话 |
| 项目 / Workspace 绑定 | Space | 用户在 Space 打开项目，项目上下文是环境自带的 |
| 数据等级判定（项目标签、文件标签、DLP 扫描、运行时内容识别） | Space / Runtime | 数据入口在 Space，标签是 Space 的资产配置；取所有信号最高等级 |
| 任务类型 / Service Class 选择 | Space / Runtime | 来自 Workflow 配置、应用模板、项目默认或分类器——属于上下文 |
| 身份委托链构建（Agent spawn 时） | Runtime | Agent 在 Runtime 中创建，委托链是执行过程自然产生的 |
| 执行上下文组装与背书 | Space / Runtime | 将上述信息打包为可信上下文，随请求发出 |
| Agent 执行、Workflow、Tool Calling | Runtime | 运行语义 |
| Run Graph、Artifact、Verifier | Runtime | 执行事实 |
| 策略评估（给定 user + project + data level → 允许什么） | Fabric | 约束施加 |
| Effective Policy 计算（继承默认 + 用户偏好 → Clamp） | Fabric | 约束施加 |
| Budget Waterfall（给定成本中心 → 哪个账户） | Fabric | 经济约束 |
| 产能调度（给定约束 → 哪个产能池 / 产能源） | Fabric | 资源约束 |
| Run Grant 签发（短期授权，子 Grant ⊆ 父 Grant） | Fabric | 授权模型 |
| Admission Control | Fabric | 准入控制 |
| 计量、预占、结算、对账、归因 | Fabric | 经济计量 |
| Credential Broker（Provider Key 管理） | Fabric | 凭据不下发 |
| Outcome 经济性 | Fabric | 结果与成本归因 |
| 路由优化、质量画像、异常检测 | Fabric | 智能优化 |
| 防御性深度扫描（可选，只能升级不能降级） | Fabric（可选） | 安全网，非主判定 |

> **注意**：此前将"身份"整体放在 Fabric 的列中。此处修正——身份认证和委托链构建归 Space / Runtime，Fabric 只负责身份模型管理（Principal 类型、Run Grant 签发）和审计记录。

---

## 4. 两层之间的契约

**Space / Runtime → Fabric（发出）：**

```text
Run Request（用户意图 + Service Class + 偏好）
  + 已认证 Principal（who）
  + 项目绑定（for what）
  + 数据等级（with what，已取最高）
  + 任务类型（what kind）
  + 身份委托链（delegation）
  + 执行环境（workspace / repo / env）
```

**Fabric → Space / Runtime（返回）：**

```text
Compiled Run（有效策略 + 产能授权 + 预算预占 + 执行计划）
  + Run Grant（短期执行授权）
  + Decision Receipt（为什么这么决策，可解释）
  + 错误模型（如果被拒，可操作的原因和建议）
```

---

## 5. 对象映射

KodaX Fabric 不重新实现 Agent Runtime，而是利用 KodaX 已经拥有的运行语义。

|KodaX 对象|Fabric 对象|
|---|---|
|Provider|Capacity Source Adapter|
|Space Workspace|Project / Execution Context|
|Session|Session|
|Workflow Run|Run|
|Agent|Principal / Agent Node|
|Child Task|Delegated Child Run|
|Model Call|Invocation|
|MCP / Tool Call|Metered Tool Invocation|
|Run Graph|Execution Graph|
|Verifier|Outcome Evidence|
|Artifact|Outcome Artifact|
|Provider Keychain|Edge Credential Broker|
|A2A Identity|External Agent Principal|

---

## 6. 三层关系总结

```text
KodaX Space / Runtime 确立上下文并提供执行事实
    ↓ 可信上下文 + 执行事实（context-attested run request）
KodaX Fabric 施加约束、调度资源、计量经济性
    ↓ Compiled Run + Run Grant
KodaX Space / Runtime 执行
    ↓ 仅普通协议
实际模型 Provider
```

---

# 二十三、商业产品结构

|商业模块|内容|
|---|---|
|Fabric Core|统一接入、身份、模型目录和基础路由|
|Capacity & Scheduler|产能池、共享、借用、预留和公平调度|
|Ledger & FinOps|预算、预占、结算、Showback 和 Chargeback|
|Govern|Policy、数据治理、审批、DLP 和审计|
|Observe|Run Trace、Agent Graph 和异常检测|
|Outcome & Optimize|结果归因、质量画像、预测和智能路由|
|Enterprise Deployment|私有部署、多区域、Air-Gapped 和高可用|
|KodaX Native|Space、Runtime、Workflow 深度集成（MCP / A2A 由 Runtime 适配，Fabric 不参与协议层）|

收费更适合采用：

- 企业平台许可；
    
- 活跃用户和 Agent 数；
    
- 管理的产能源数量；
    
- 数据面吞吐等级；
    
- 私有部署节点；
    
- 高级治理和智能模块；
    
- 企业支持服务。
    

不建议默认按客户 Token 消费比例抽成，因为这会与“帮助客户减少无效消耗”的价值冲突。

---

# 二十四、明确的产品边界

KodaX Fabric 不做以下事情：

1. 不把所有模型 Token 强行换算成一种物理 Token；
    
2. 不池化合同不允许共享的个人订阅和账号；
    
3. 不把员工 Token 消耗直接用于个人绩效排名；
    
4. 不替代 Kubernetes 或底层 GPU Pod Scheduler；
    
5. 不重新实现完整 Agent Runtime；
    
6. 不默认保存所有 Prompt 和响应正文；
    
7. 不让 LLM 决定安全、合规和预算硬规则；
    
8. 不只优化最低调用价格而忽略结果质量；
    
9. 不把路由做成不可解释的黑盒；
    
10. 不要求所有企业应用一次性重写。
    

---

# 二十五、最终产品表达

## 面向普通用户

> 只需要描述任务，KodaX 会自动使用合适、可用且符合企业要求的 AI。

## 面向开发者

> 一个身份、一个入口、一套 Service Class，访问企业所有模型和 Agent 产能。

## 面向平台团队

> 将外部 API、自建 GPU、预算、权限、路由和 Agent 运行统一到一个控制平面。

## 面向管理者

> 看清每一份 AI 产能由谁使用、如何分配、产生多少成本、获得什么结果。

最终产品主张：

> **KodaX Fabric：统一企业 AI 产能，按任务价值而不是 Token 数进行调度。**

完整控制循环是：

```text
用户意图
→ 上下文编译
→ 身份和策略
→ 预算与容量预占
→ 智能调度
→ Agent 执行
→ 增量计量
→ 成本结算
→ 结果验证
→ 持续优化
```

这套设计中，复杂性并没有消失，而是被放到了正确的位置：

```text
普通用户承担任务表达
开发者承担服务意图
项目管理员承担默认配置
企业管理员承担政策和预算
KodaX Fabric 承担上下文编译与实时调度
```

因此，平台可以具备完整、严谨的企业控制能力，同时保持前台体验足够简单。

---

# 附录：归属 KodaX / KodaX Space 的能力

> 以下能力在分层修正前曾归属 Fabric 或归属不明确。经分层理清后，它们属于 **KodaX Space / Runtime（执行层）**，不属于 Fabric（控制平面）。
>
> **共同特征**：它们回答"who / what / where"（谁、在哪个项目、处理什么数据、什么类型任务、谁委托的谁），这些信息天然存在于执行层。Fabric 回答"with what resources / under what rules / at what cost"，是控制平面的职责。两层之间通过可信上下文契约连接。

---

## 1. 用户认证（SSO）— 归属 Space

**做什么**：用户在 KodaX Space 登录，Space 持有会话，完成身份认证。Space 完成认证后将已认证 Principal 作为可信上下文发给 Fabric。

**为什么不在 Fabric**：认证是用户交互的第一步，天然发生在用户入口（Space）。Fabric 是旁路控制平面，不在用户交互路径上。Fabric 不认证任何人——它信任 Space / Runtime 传来的身份。

---

## 2. 项目 / Workspace 绑定 — 归属 Space

**做什么**：用户在 Space 打开某个 Workspace，Workspace 绑定了项目。项目上下文是环境自带的——就像 `git commit` 不需要猜你在哪个仓库。Space 将项目绑定作为可信上下文发给 Fabric，Fabric 据此查项目的策略 / 预算 / 产能绑定。

**为什么不在 Fabric**：项目是 Space 的资产配置。Fabric 没有理由"感知"用户在哪个项目——Space 告诉它就行。如果项目没绑定，那是 Space 的配置问题，不是 Fabric 的问题。

---

## 3. 数据等级判定 — 归属 Space / Runtime

**做什么**：数据分类的全部信号来源都在 Space / Runtime 侧：

- 项目固定标签
- 数据连接器标签
- 文件或仓库标签
- 企业 DLP 规则
- 运行时内容识别（DLP 扫描、敏感模式匹配）
- 用户主动选择更严格等级

Space / Runtime 取所有信号的最高等级，作为可信上下文发给 Fabric。规则是"只能升级，不能降级"——系统不能因为自动分类器置信度低就将数据降级。

**为什么不在 Fabric**：数据入口在 Space——prompt 在 Space 产生，文件在 Space 读写，DLP 扫描应在数据发出前由 Space 完成。Fabric 只接收等级并执行策略（如"Confidential 禁止外部模型"、"必须脱敏"、"只能私有区域"）。Fabric 可选做防御性深度扫描，但只能升级不能降级，作为安全网而非主判定。

---

## 4. 任务类型 / Service Class 选择 — 归属 Space / Runtime

**做什么**：任务类型解析优先级：

```text
显式 Workflow 类型
    >
应用模板配置
    >
项目默认类型
    >
Service Class
    >
规则识别
    >
轻量任务分类器
    >
通用默认类型
```

全部是上下文判定，来源是 Workflow 配置、应用模板、项目默认或分类器——这些都在 Space / Runtime 侧。Space / Runtime 判定任务类型后连同数据等级一起作为可信上下文发给 Fabric。

**为什么不在 Fabric**：任务类型是"这是什么类型的任务"——属于上下文（what kind），不是约束（what's allowed）。Fabric 接收任务类型用于调度，不重新判定。自动分类器只用于补充信息，不能降低数据等级或绕过安全策略。

---

## 5. 身份委托链构建 — 归属 Runtime

**做什么**：Agent 在 Runtime 中创建和 spawn。委托链（Human → KodaX Space → Workflow → Main Agent → Child Agent → Tool）是 Runtime 执行过程自然产生的。Runtime 生成不可伪造的 Principal Chain，作为可信上下文的一部分发给 Fabric。

**为什么不在 Fabric**：委托链是执行过程的副产物——Agent 在 Runtime 里跑，Runtime 自然知道谁 spawn 了谁。Fabric 不在执行路径上，无法自行构建委托链。Fabric 的职责是接收委托链、签发 Run Grant（子 Grant ⊆ 父 Grant）、记录审计。

---

## 6. 执行上下文组装与背书 — 归属 Space / Runtime

**做什么**：Space / Runtime 将上述五项（身份、项目、数据等级、任务类型、委托链）加上执行环境（Workspace、仓库、环境、会话、父级 Run、数据源、成本中心）打包为**可信上下文**，随 Run Request 一并发给 Fabric。

这是两层之间的契约：

```text
Space / Runtime → Fabric（发出）：
  Run Request（用户意图 + Service Class + 偏好）
    + 已认证 Principal（who）
    + 项目绑定（for what）
    + 数据等级（with what，已取最高）
    + 任务类型（what kind）
    + 身份委托链（delegation）
    + 执行环境（workspace / repo / env）

Fabric → Space / Runtime（返回）：
  Compiled Run（有效策略 + 产能授权 + 预算预占 + 执行计划）
    + Run Grant（短期执行授权）
    + Decision Receipt（为什么这么决策，可解释）
    + 错误模型（如果被拒，可操作的原因和建议）
```

**为什么不在 Fabric**：上下文的每个组成部分都来自执行层。Fabric 如果自己组装上下文，就需要伸手到 Space 的领域（文件、会话、用户会话）去推导——这是不应该存在的耦合。**Fabric 是上下文的消费者，不是生产者。** Space / Runtime 背书上下文，Fabric 信任并校验，但不自行推导。

---

> **总结**：这六项能力的归属修正，使得 Fabric 的职责边界清晰——它只做"约束施加 + 资源管理 + 经济计量"，不做"上下文确立"。这不仅让架构更干净，也让 Fabric 的 onboarding 更轻：Fabric 不需要等企业的 SSO / DLP / 项目绑定全部就绪才能提供价值，它只需要 Space / Runtime 把已确立的上下文传过来。

---

## 7. 完全成本计算 — 归属企业 FinOps / 财务

**做什么**：将自建 GPU 资源的固定成本（GPU 租赁分摊、闲置容量分摊、平台开销、运维）分摊到每次调用，计算完全成本（Fully-Loaded Cost）。

**为什么不在 Fabric**：完全成本需要对接企业的固定资产台账、折旧政策、成本中心分摊规则。这是企业财务 / FinOps 部门的会计工作，不是 LLM 网关的职责。Fabric 只计算边际成本（GPU 秒 × 变动费率 + 能耗 + 网络）用于调度决策，并导出原始用量数据（GPU 秒、API 费用、请求数）供企业 FinOps 工具做完全成本分析。

---

## 8. Outcome Evidence 主动采集 — 归属 Runtime / Space

**做什么**：从外部系统采集 Outcome Evidence：

- PR 合并事件 → 对接 Git 平台 API（GitHub / GitLab / Bitbucket）
- 工单状态 → 对接工单系统 API（Jira / Linear / 自建系统）
- 业务系统回调 → 对接业务系统 Webhook

**为什么不在 Fabric**：Fabric 是 LLM 网关，不直接对接 Git 平台、工单系统和业务 API。这些集成是 Runtime / Space 的职责——Runtime / Space 对接外部系统后，将 Evidence 报告给 Fabric 做跨 Run 聚合分析。就像 Fabric 不直接调 MCP 工具一样，它也不直接调 Git API。

---

## 9. Artifact 指纹生成 — 归属 Runtime

**做什么**：对 Agent 产出的 Artifact（文件、文档、PR、测试报告）计算内容指纹（hash），用于检测重复、统计多样性和复用率。

**为什么不在 Fabric**：

1. Fabric 只能看到 LLM 的原始输出文本，不是最终 Artifact。Artifact 是 Agent 加工后的产物，中间有 Agent 的加工（LLM 输出代码 → Agent 写成文件，可能还修改了 import、加了类型标注）。
2. 在非 Full 数据保存模式下（Metadata Only / Zero Retention / Local Only），Fabric 连 LLM 输出内容都看不到，更别说打指纹。
3. Runtime 始终有 Artifact 内容（它创建了 Artifact），不受数据保存模式限制。hash 不泄露内容（不可逆），跨数据模式都安全。

**Fabric 的角色**：接收 Runtime 报告的指纹（hash），做跨 Run 去重检测、多样性统计、采纳率和复用率分析、Artifact ROI 计算。

---

## 10. Agent / Runtime 可见但 Fabric 不可见的文件级上下文

> 以下信息在 Agent / Runtime / Space 侧可见，但 Fabric 看不到。Fabric 通过解析 LLM 工具调用输出可以做到文件级成本归因，但更深层的信息需要 Runtime / Space 报告。

| 信息 | 谁能看到 | Fabric 能看到吗 | 说明 |
|---|---|---|---|
| 工具调用执行结果（成功 / 失败） | Runtime | ❌ | Fabric 看到请求，看不到执行结果 |
| 文件最终内容 | Runtime / Space | ❌ | Fabric 看到编辑请求，看不到最终文件 |
| Agent 自主文件操作（非 LLM 工具调用） | Runtime | ❌ | Agent 可能自己读写文件，不经过 LLM |
| 文件是否被用户采纳 | Space | ❌ | 用户操作在 Space |
| 文件后续修改历史 | Runtime / Space | ❌ | 版本控制在 Runtime / Space |
| Artifact 类型分类 | Runtime | ❌ | 需要 Workflow / Agent 语义判定 |

**Fabric 能独立做的**：解析 LLM 工具调用输出 → 提取文件路径、操作类型、Token 成本 → 按文件归因成本 → 检测同一文件的多次编辑（重试）。

**需要 Runtime / Space 补充的**：执行结果（成功 / 失败）、文件最终状态、用户采纳状态、文件修改历史、Artifact 类型分类。这些是 KodaX 其他体系未来需要建设的能力。