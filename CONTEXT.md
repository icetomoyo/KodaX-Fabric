# KodaX Fabric

企业级 Token 统一接入与 Token ROI 平台。企业所有 LLM API 调用经过 Fabric 网关。

## Language

**KodaX Fabric**:
产品本身：Token Hub + Token ROI。统一接入、计量，并回答 Token 花在哪、值不值。
_Avoid_: Agent 控制平面, Agent Runtime, 产能调度平台

**零转换透传**:
OpenAI 系端点只路由 OpenAI 系 Provider，Anthropic 系端点只路由 Anthropic 系 Provider。不改写请求/响应体。换 Channel 只换上游凭据和地址，不改 body，不把 `model` 改成另一个字符串。
_Avoid_: 跨协议转换, 统一适配器, 跨 model Fallback

**OpenAI 系**:
讲 OpenAI Chat Completions 协议的上游，包括兼容该协议的 base URL。
_Avoid_: 只等于官方 OpenAI, Azure OpenAI（鉴权/路径不兼容时另算）

**Anthropic 系**:
讲 Anthropic Messages 协议的上游。

### Access

**企业**:
权限和数据的隔离边界。集团下属公司和客户公司都是企业：公司 A 的人看不见公司 B 的账、User、VK。集团不是树上的一层——超级管理员看见扁平的企业名单。超级管理员在所有企业之上；其他企业里最高是企业管理员。名字创建后不可改、不可删。
_Avoid_: 账号, 集团（不是父实体）, Tenant

**Team**:
Fabric 的成本桶。属于恰好一个企业。Virtual Key 属于一个 Team。一次调用记到哪个 Team，只看这把 VK 的绑定。名字创建后不可改、不可删。P1 里叫 Project 的那种桶，就是它。
_Avoid_: Project, Space 项目, 部门（口头可以，账本上是 Team）

**Space 项目**:
KodaX Space 的本地工作目录，不是 Fabric 实体。P2 不创建、不绑 VK、不进报表主键。以后怎么从 Space 带过来，另议。
_Avoid_: Team, Fabric Project

**Virtual Key**:
调用方拿着的凭证，绑定一个 Team，不是登录身份。明文只在创建时出现一次。可以创建、停用、再启用；停用后新请求立刻拒绝。换秘密 = 新建一把再停用旧的，没有轮换。
_Avoid_: API key（会和 Provider Key 混）, token, User

**User**:
能登录 Fabric 的人。不是成本桶，也不是调用凭据。恰好一个角色。属于一个企业（超级管理员除外，不属于任何企业）。不开放注册。本地密码。可停可开、不删。
_Avoid_: 账号, account, 调用方

**超级管理员**:
平台级登录角色。不属于任何企业。创建/停用企业和企业管理员，配置平台共享的 Provider / Provider Key / Channel / 成本价和全局对客倍率。看全平台成本、对客金额、毛利。不建 Team、不发业务 VK，不设平台总预算闸。企业里的人不能自助获得这个角色；平台侧可以有多人。
_Avoid_: 企业管理员, Admin（已废弃的两角色模型）

**企业管理员**:
一个企业内部的最高登录角色。看不见其他企业。创建 Team，创建团队管理员和开发者并派进 Team，配置本企业与各 Team 的预算和限流，可在本企业任意 Team 发 VK。不加入 Team。看不见 Provider Key。
_Avoid_: 超级管理员, 团队管理员

**团队管理员**:
登录角色。加入一个或多个 Team。本 Team：账、Request 主行、VK、加/撤开发者、看预算/限流剩余。不能造团队管理员，不能改预算/限流。
_Avoid_: 企业管理员, 开发者

**开发者**:
员工登录角色。加入一个或多个 Team。本 Team：账、Request 主行、发/停/启 VK、看预算/限流剩余。不是调用方。
_Avoid_: 调用方, 员工（口头可以说员工，角色名是开发者）

**成员**:
团队管理员或开发者与 Team 的多对多关系。可加可撤。撤掉立刻看不见该 Team；已发出的 VK 仍能打。企业管理员不走成员关系。
_Avoid_: Team（桶本身）, 审批, 角色叠加

**平台控制台**:
超级管理员的界面。企业列表与下钻、线路、成本价、对客倍率、全平台成本/对客/毛利、Request 的 Attempt 快照。
_Avoid_: 企业控制台, 团队控制台

**企业控制台**:
企业管理员的界面。本企业 Team、User、预算、限流、VK、按成本价的报表和 Request 主行。没有线路、没有对客价、没有 Attempt 快照。
_Avoid_: 平台控制台, 团队控制台

**团队控制台**:
团队管理员与开发者的界面。按角色藏按钮。本 Team 的账（成本价）、Request 主行、VK；团队管理员可加/撤开发者。
_Avoid_: 平台控制台, 企业控制台, 用户端

**Provider**:
上游 LLM 厂商：协议家族 + base URL。换地址就是另一个 Provider，不是另一把钥匙。
_Avoid_: Channel, 渠道

**Provider Key**:
属于一个 Provider 的凭据，加密存放，永不下发给调用方，也不出现在日志和 API 响应里。一把 Key 可以进入多个 Model 的池。可停可开、不删；停用后从所有池里拿掉。
_Avoid_: API key（单独说）

**Model**:
线路上的 `model` 字符串，也是查找键和账本上的 Model。它选定该字符串下的 Channel 池，不是一对 Provider + Provider Key。未登记、或池里没有可调用的 Channel，不能调用。
_Avoid_: 别名, 渠道, 把另一个 model 字符串当成这个 model

**Channel**:
同一 Model 下的一条上游路径：一把 Provider Key，加上权重和优先级。同一 (Model, Provider Key) 只能有一条。调用方看不见 Channel，只传 `model`。可调用 = 管理员未停用、Key/Provider/Model 未停用、Health 不是 open、有价格、家族与端点匹配。Failover 只在同一 Model 的 Channel 之间换，不改请求体。
_Avoid_: 别名, 渠道池（那是一组 Channel）, Provider（厂商不是路径）

**Health**:
Channel 的自动熔断状态（closed / open / half-open），和管理员停用不是同一根开关。进程内保存，重启即 closed。open 不入池。半开只放行 1 个 in-flight 探测（真实入口），其余请求仍把这条当成 open。一次 Attempt 算成功 ⇔ 它不会触发 failover。默认：最近 100 次成功率 < 80% 则 open，open 满 30s 变半开。
_Avoid_: 管理员停用, disabled, 按 HTTP 2xx 算成功

### Ledger

**Request**:
一次经过网关的入口 HTTP 调用，不论成败——包括限流 429、预算 402、鉴权失败。账本里不可改的一粒。内部为同一 Model 换 Channel 不新开粒。Usage 和状态来自最终尝试（未打上游则为 0 与拒绝码）；cost 是各次有 Usage 的尝试之和。对客金额按当时全局倍率 × cost 一并写入，以后改倍率不翻旧账。尝试快照随 Request 一次写入。禁止 UPDATE。可选带不透明的 `task_type`，当前不解释。
_Avoid_: 日志行, 事件, 一次上游尝试

**Attempt**:
一次入口 Request 内部对某一条 Channel 的一次上游调用。不是账本的一粒。快照里记下 Channel、状态、Usage、成本、是否被调用方看见。
_Avoid_: Request, 重试, 审计日志

**Budget**:
挂在成本桶上的花费熔断器，不是账房。按 **成本** 计，不按对客金额。Team 可配；企业级（该企业下所有 Team 之和）可选，默认关。没有平台总闸。没配 = 无限。Team 与企业独立跳闸，不是瀑布。允许短暂超卖；已配置且已越过的硬限制让新请求 402。软限制只打响应头。窗口按 Asia/Shanghai 的日或月切。打上游之前检查；回来后按各 Attempt 成本之和事后扣减。
_Avoid_: 预占, 对客额度, Credit, 永不超卖, 瀑布消耗, 平台总闸

**限流**:
Virtual Key 与 Team 上的 RPM 硬限制，超了 429。按入口 HTTP 计 1 次，不按 Attempt。打上游之前先查限流再查预算。不是 Budget。进程内计数，重启后清空。没配 = 无限。
_Avoid_: 排队, 按 Provider, 令牌预占

**Usage**:
Provider 响应里的 token 计数（input / output / cached）。Fabric 的 token 数只来自这里。Request 上的 Usage 来自最终 Attempt；每次 Attempt 自己的 Usage 在快照里。
_Avoid_: 本地 tokenizer, 字符估算

**Run**:
Request 上的可选分组键，不是账本的一粒。只认调用方显式传入的 `run_id`；没有就是空，不做时间窗口推断。
_Avoid_: session, conversation, trace, 推断 Run

**Adjustment**:
纠正账本的唯一方式：再追加一行差额。不改历史 Request。当前阶段还不做。
_Avoid_: 改流水, 编辑 Request

**成本价**:
每条 Channel 一行（输入 / 输出 / 缓存），货币为 CNY。付给这条路径所打上游的价。没有成本价的 Channel 不能被选中。企业侧报表只用这个。
_Avoid_: 对客价, 每 Model 一行

**对客价**:
全局倍率 × 该次 Request 的成本。超级管理员改倍率。只在平台控制台出现成本和毛利。不是账单，不是 Credit。
_Avoid_: 每企业一张价表, 套餐, 标准价（那是 Phase 4 的词）

**日**:
报表里的一天，按 Asia/Shanghai 切。Request 的时刻按此时区归日。
_Avoid_: UTC 日, 每个企业自己的时区
