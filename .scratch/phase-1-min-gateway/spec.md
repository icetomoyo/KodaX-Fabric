Status: ready-for-agent

# Phase 1 最小网关

## Problem Statement

企业要把真实 LLM 流量从直连 Provider 切到一处，第一次看清每个 Project 每天花了多少钱。现有 OpenAI SDK / Anthropic SDK 应用不能重写。今天仓库里还没有可跑的网关，直连会让 Provider Key 散落在各处，也没有按 Project 入账的 Request。

## Solution

交付一个可 Compose 拉起的 KodaX Fabric 进程：两个端点做零转换透传，调用方只用 Virtual Key；管理员在四页管理台里配置 Provider、Provider Key、Model、价格表和 Virtual Key，并按 Project × Model × 日查看用量与成本。第一批流量是管理员自己的真实 Project。

## User Stories

1. As a 开发者, I want 把 OpenAI SDK 的 `base_url` 和 `api_key` 改成 Fabric 与一把 Virtual Key, so that 现有 Chat Completions 调用不用改业务代码就能过网关
2. As a 开发者, I want 把 Anthropic SDK 的 `base_url` 和 `api_key` 改成 Fabric 与一把 Virtual Key, so that 现有 Messages 调用不用改业务代码就能过网关
3. As a 开发者, I want 非流式 `POST /v1/chat/completions` 的响应体与直连该 OpenAI 系 Provider 一致, so that 零转换透传不会丢字段
4. As a 开发者, I want 非流式 `POST /v1/messages` 的响应体与直连该 Anthropic 系 Provider 一致, so that thinking 块、cache_control、tool_choice 都还在
5. As a 开发者, I want 流式调用逐 chunk 收到与上游相同的 SSE, so that 客户端不用为 Fabric 改解析
6. As a 开发者, I want 流式时 Fabric 不缓冲整段响应, so that 首 token 延迟接近直连
7. As a 开发者, I want 断开流式连接时 Fabric 取消上游, so that 不会在客户端走后继续烧 Provider
8. As a 开发者, I want 用线路上的 `model` 字符串打到已登记的那一对 Provider + Provider Key, so that SDK 里写的模型名就是路由键
9. As a 开发者, I want 未登记的 `model` 被拒绝, so that 我能立刻发现配错了模型名
10. As a 开发者, I want 已登记但没有价格行的 Model 被拒绝, so that 不会出现放行却算不出成本的调用
11. As a 开发者, I want 无效或缺失的 Virtual Key 被拒绝, so that 没有凭证的流量进不了网关
12. As a 开发者, I want 已停用的 Virtual Key 立刻被拒绝, so that 泄露后可以马上停
13. As a 开发者, I want 不传 `x-fabric-context` 也能调用, so that 最小接入仍是两行配置
14. As a 开发者, I want 传入的 `run_id` 记在对应 Request 上, so that 我能事后按 Run 把多次调用收在一起
15. As a 开发者, I want 不传 `run_id` 时 Request 上的 Run 为空, so that Fabric 不会把不相关的调用捏成一次 Run
16. As a 开发者, I want `x-fabric-context` 里的 `project_id` 与 Virtual Key 绑定的 Project 一致时调用成功, so that 我可以显式声明自己以为的项目
17. As a 开发者, I want `project_id` 与 Virtual Key 绑定不一致时被拒绝, so that 一把 Virtual Key 不能把账记到别的 Project
18. As a 开发者, I want `task_type` 被原样记下且不影响路由, so that 以后分析还能看到我标的类型
19. As a 开发者, I want 畸形的 `x-fabric-context` 被拒绝, so that 静默忽略不会让我以为上下文生效了
20. As a 开发者, I want 调用 OpenAI 兼容的第三方 base URL（仍登记为 OpenAI 系）, so that DeepSeek 这类不必等官方 OpenAI
21. As a 开发者, I want 打到未开放的路径（embeddings、images、completions、Responses API）失败, so that 我不会以为那些流量已经在账上
22. As a 开发者, I want OpenAI 系端点不会把流量送到 Anthropic 系 Provider, so that 零转换透传的家族边界不被打破
23. As a 开发者, I want 上游 4xx/5xx 时仍能收到与直连相近的错误响应, so that 应用层的重试逻辑不用为 Fabric 改
24. As a 管理员, I want 用一个本地账号登录管理台, so that 只有我能改配置和看账
25. As a 管理员, I want 创建 Project 并在创建后不能改名、不能删除, so that 报表主键不会对不上历史 Request
26. As a 管理员, I want 登记一个 OpenAI 系 Provider 及其加密存放的 Provider Key, so that Fabric 能替调用方去打上游
27. As a 管理员, I want 登记一个 Anthropic 系 Provider 及其加密存放的 Provider Key, so that Messages 流量有上游
28. As a 管理员, I want 为每个 Model 指定唯一的一对 Provider + Provider Key, so that P1 的查找键就是 `model` 字符串
29. As a 管理员, I want 给每个 Model 写一行 CNY 成本价（输入 / 输出 / 缓存）, so that 每条 Request 的成本可复算
30. As a 管理员, I want 没有价格行就不能让该 Model 被调用, so that 账上不会出现成本为「免费」的成功流量
31. As a 管理员, I want 去掉某 Model 的价格行后新调用被拒绝, so that 停价和停用效果一致
32. As a 管理员, I want 停用一个 Model 或 Provider 后新调用被拒绝, so that 我不必物理删除配置
33. As a 管理员, I want 创建 Virtual Key 时看到一次明文、并把它绑到一个 Project, so that 我能发给自己的应用且知道账记在哪
34. As a 管理员, I want 之后再看该 Virtual Key 时看不到明文, so that 管理台不会变成密钥保管箱
35. As a 管理员, I want 停用 Virtual Key 后新请求立刻失败, so that 轮换等于新建一把再停旧的
36. As a 管理员, I want 创建多把 Virtual Key 绑到不同 Project, so that 我能分开看几个真实项目的钱
37. As a 管理员, I want 用量报表按 Project × Model × 日（Asia/Shanghai）聚合, so that 我能回答「每个项目每天花了多少」
38. As a 管理员, I want 报表上的 token 数与各条 Request 上记录的 Usage 之和一致, so that 误差为 0
39. As a 管理员, I want 报表上的成本能用当时价格表对每条有 Usage 的 Request 复算对上, so that 账可以审计
40. As a 管理员, I want 失败或上游未给 Usage 的调用也出现在账里（token 与成本为 0，状态可见）, so that 失败流量不会从报表里蒸发
41. As a 管理员, I want 客户端中途断开且最后 chunk 带了 Usage 时仍按有 Usage 入账, so that 已经发生的消耗被记下
42. As a 管理员, I want 客户端中途断开且没有 Usage 时仍有一条 Request（token 与成本为 0）, so that 断开也是一次调用
43. As a 管理员, I want 在数据库、日志、管理台响应里永远看不到 Provider Key 明文, so that 凭据不下发
44. As a 管理员, I want 管理台只有四页：Provider/Key、Virtual Key、价格表、用量报表, so that P1 不把工期花在定制界面上
45. As a 管理员, I want 一条命令用 Compose 拉起网关、管理台和 PostgreSQL, so that 我能在自己的机器上切真实流量
46. As a 管理员, I want 没有注册入口、也不能再开第二个管理员, so that P1 没有多租户和角色模型
47. As a 管理员, I want 不能新增 Adjustment、也不能改或删任何 Request, so that 账本保持 append-only
48. As a 管理员, I want 不能给同一个 `model` 字符串挂第二把 Provider Key, so that P1 不会偷做渠道池
49. As a 管理员, I want 不能配置 Model 别名, so that SDK 传入值与路由键始终是同一个字符串
50. As a 调用方系统, I want 计量写入不挡住响应返回, so that 入账失败不应变成调用方超时
51. As a 调用方系统, I want 网关自身开销（不含 Provider 等待）P99 小于 50ms, so that 切流量后体感仍接近直连
52. As a 后续阶段的实现者, I want Request 上留着显式 `run_id` 和未解释的 `task_type`, so that Phase 3 归因不必回填推断 Run

## Implementation Decisions

- 一个 Fabric 模块：单进程同时提供透传端点、管理台 HTTP 和异步入账。对外只有 HTTP 这一条缝。
- 对内一条出站缝：打向 Provider 的调用。线上 adapter 是真实 HTTP；测试 adapter 是录制 fixture 回放。没有第三条对外缝（不把计量、路由、仓储暴露给调用方或测试）。
- 只开放 `POST /v1/chat/completions` 与 `POST /v1/messages`。解析请求只为取出 `model`、`stream`；解析响应只为取出 Usage。请求/响应体不改写。
- SSE 逐 chunk 转发。客户端断开则取消上游。流结束（或断开时已有最后 Usage）再算成本、append 一条 Request。
- 路由：`model` 字符串唯一映射到一对 Provider + Provider Key。家族必须匹配端点（OpenAI 系端点不得打到 Anthropic 系）。未登记、已停用、无价格行 → 拒绝。
- Virtual Key：创建时返回一次明文，只存哈希。绑定恰好一个 Project。只有创建与停用。停用后新请求立即拒绝。鉴权失败不得打到 Provider。
- Project：独立成本桶，无父级。名字创建后不可改、不可删。一次调用的 Project 只来自 Virtual Key。`x-fabric-context.project_id` 缺省或一致则通过，不一致或畸形则拒绝。`task_type` 原样写入 Request，不解释。`run_id` 只认显式值；没有就是空。不实现时间窗口推断（覆盖 PRD §3.1 该行；见 ADR-0003）。
- Request：每次 HTTP 调用 append 一行，含 Virtual Key、Project、Model、Usage（input/output/cached，没有则 0）、成本、延迟、状态、可选 Run、可选 `task_type`。禁止 UPDATE/DELETE。P1 不实现 Adjustment。
- 成本：价格表每 Model 一行，CNY，输入/输出/缓存单价。成本 = Usage × 对应单价。没有价格就不能调用。
- Usage 只来自 Provider 响应。不跑本地 tokenizer，不按字符估。
- 报表「日」按 Asia/Shanghai 切；时刻按 UTC 存放。
- 配置与 Request 存在 PostgreSQL。P1 不部署 Redis。
- Provider Key 用 AES-256-GCM 加密存放；日志与一切 HTTP 响应不得出现明文。
- 管理台：一个本地管理员，bcrypt。四页，现成组件库，不做定制视觉。静态前端由同一 Compose 托管。
- 部署：Docker Compose 一条命令。单进程贯穿；不拆微服务、不上 K8s、不引入 Kafka。
- 语言与运行时按已接受的 PRD：Go 二进制 + React 管理台 + PostgreSQL。
- 遵守 `CONTEXT.md` 与 `docs/adr/0001`–`0009`。

## Testing Decisions

- 好测试只穿过对外 HTTP 缝：给定请求（含头、体、流式断开），断言响应（状态、头、体或 SSE 字节序列）以及随后管理台报表/Request 查询所见。不断言内部函数、表结构或 goroutine。
- Provider 出站缝在测试里只插 fixture 回放 adapter。每个被支持的协议家族至少有非流式与流式两套录制响应（含带 Usage 的成功、无 Usage 的错误、流式中途断开）。禁止测试打到真实 Provider，除非另开手工验收。
- 覆盖的外部行为：两行接入、零转换（响应与 fixture 一致）、未知/无价格/停用/错误 VK、`project_id` 冲突与畸形头、显式 `run_id` 与空 Run、失败也入账、报表三维聚合与上海日界、成本可复算、Provider Key 不出现在任何测到的响应或日志捕获、未开放路径被拒、跨家族拒绝。
- 延迟 P99 用针对网关自身的测量（fixture 立即返回），与 Provider 等待时间分开。
- 仓库里没有既有测试可当 prior art。第一批测试就是这条 HTTP 缝上的契约/回放套件；后续阶段加测试只加在同一条缝上，除非再出现第二个真实 adapter。

## Out of Scope

- 跨协议转换；在 Fabric 层调用 LLM；本地 tokenizer
- 渠道池、同 Model 多 Key、别名、Fallback、重试策略、熔断、限流、预算
- Organization / Team、多租户、多管理员、VK 审批流、VK 轮换原语
- Adjustment、改/删 Request、物理删除 Project/Model/Provider/VK
- Run 时间窗口推断
- Azure OpenAI（鉴权或路径与 OpenAI 系不兼容时）
- embeddings / images / completions / Responses API 及其它未列端点
- Token 分类、文件归因、浪费检测、ClickHouse、ROI 路由
- Commerce（标准价、Credit、套餐、账单）
- Kafka、K8s、微服务拆分、Redis
- Agent Runtime / GPU 调度
- 修改 `archive/` 中的历史稿使之与本 spec 对齐（现行规格是本文件 + `CONTEXT.md` + ADR）

## Further Notes

- 活文档：`docs/PRD.md`（阶段切分与五条原则）、`CONTEXT.md`（术语）、`docs/adr/0001`–`0009`（硬决策）。本 spec 与 ADR-0003 冲突的 PRD §3.1「VK + 30 分钟推断 Run」以 ADR 与本 spec 为准。
- 上线条件：管理员把自己的真实 Project 切到这两个端点，报表能按 Project × Model × 日给出成本。
- 下一技能：`/to-tickets` 把本 spec 拆成带阻塞边的 tracer-bullet 票，写入 `.scratch/phase-1-min-gateway/issues/`。
