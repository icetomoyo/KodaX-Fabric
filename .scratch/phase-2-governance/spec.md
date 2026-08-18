Status: ready-for-agent

# Phase 2 治理层

## Problem Statement

P1 能透传、能按桶记账，但一个 Model 只能挂一把 Key，没有企业隔离，也没有限流/预算/熔断。第一个真实租户之外的公司不能进来；一条上游挂了，调用方只能自己重试。

## Solution

在同一条 Compose 单进程上交付可控的网关：平台一套 Channel 池，同 model 可 failover；按企业隔离；登录角色四个（超级管理员 / 企业管理员 / 团队管理员 / 开发者）；成本桶是 Team；三套控制台；Team/企业预算熔断与 VK/Team 限流；平台用全局倍率看毛利。遵守 `CONTEXT.md` 与 ADR-0001–0004、0007–0020、0022–0029（0002/0005/0006/0021 已接手或作废）。

## User Stories

### 调用方（持 VK，不登录）

1. As a 调用方, I want 线路上的 `model` 仍是查找键, so that SDK 不用改模型名
2. As a 调用方, I want 同一 `model` 下某一条 Channel 失败时在写出任何响应之前换下一条, so that 单渠道下线我无感知（除延迟）
3. As a 调用方, I want 400/422 时不换 Channel, so that 我的坏请求不会被放大
4. As a 调用方, I want 流式一旦开始转发就不再换路, so that 两条上游的流不会拼进一次响应
5. As a 调用方, I want 全池失败时收到最后一次 Attempt 的状态和 body（传输失败则为 `502 provider`）, so that 解析逻辑仍像直连
6. As a 调用方, I want 响应头可带 Fabric Request id、预算剩余、限流剩余, so that 我知道为何 402/429
7. As a 调用方, I want 响应里看不到 Channel、Provider、Provider Key、Attempt 次数, so that 线路拓扑不泄露
8. As a 调用方, I want 超 RPM 时立刻 429 且不打上游, so that 限流不会先烧钱
9. As a 调用方, I want 已越过硬预算时立刻 402 且不打上游, so that 熔断在门上
10. As a 调用方, I want 不传 `x-fabric-context` 也能调用, so that 最小接入仍是两行
11. As a 调用方, I want 传入的 `team_id` 与 VK 绑定一致时通过、不一致时拒绝, so that 我不能把账记到别的 Team
12. As a 调用方, I want 带上 `project_id` 被拒绝, so that P2 不会把 Space 项目和 Team 混在一起
13. As a 调用方, I want 一次入口无论内部换了几次 Channel 都只算一次限流, so that failover 不会把自己打进 429

### 超级管理员（平台控制台）

14. As a 超级管理员, I want 创建/停用企业, so that 内部公司和客户公司隔离
15. As a 超级管理员, I want 创建/停用企业管理员, so that 每家企业有自己的天花板
16. As a 超级管理员, I want 再任命其他超级管理员, so that 平台不锁在一个账号上
17. As a 超级管理员, I want 登记 Provider（家族 + base URL）和多把 Provider Key, so that 密钥不再焊在厂商行上
18. As a 超级管理员, I want 给一个 `model` 建多条 Channel（Key + 权重 + 优先级 + 成本价）, so that 同模型能换路
19. As a 超级管理员, I want 没有成本价的 Channel 不能入选, so that 账上不会出现免费成功流量
20. As a 超级管理员, I want 看见每条 Channel 的 Health（只读）并能手停/手开, so that 熔断不会盖住我的开关
21. As a 超级管理员, I want 设置全局对客倍率并看见成本、对客金额、毛利, so that 我能当中转站老板
22. As a 超级管理员, I want 点开 Request 看见 Attempt 快照, so that 我知道选了谁、换过谁
23. As a 超级管理员, I want 不建 Team、不发业务 VK, so that 我不替企业做人事和发钥匙
24. As a 超级管理员, I want 没有平台总预算闸, so that 客户公司不会被内部某队打爆而停服

### 企业管理员（企业控制台）

25. As a 企业管理员, I want 只看见本企业, so that 我看不见其他公司
26. As a 企业管理员, I want 创建 Team（不能改名、不能删）, so that 成本桶稳定
27. As a 企业管理员, I want 创建团队管理员和开发者并派进 Team, so that 组织能转起来
28. As a 企业管理员, I want 在本企业任意 Team 发/停/启 VK, so that 我能救急
29. As a 企业管理员, I want 配置 Team 与企业的日/月预算和 VK/Team RPM, so that 花费和速率可控
30. As a 企业管理员, I want 报表和 Request 主行按成本价, so that 队内核算不是卖价
31. As a 企业管理员, I want 看不见 Provider Key、Channel 名、对客价、Attempt 快照, so that 线路留在平台

### 团队管理员 / 开发者（团队控制台）

32. As a 团队管理员, I want 看见我加入的每个 Team 的账和 Request 主行, so that 我能管本队花费
33. As a 团队管理员, I want 在本 Team 加/撤开发者, so that 企业管理员不用管每一次入职
34. As a 团队管理员, I want 不能造团队管理员、不能改预算/限流, so that 天花板仍在企业管理员
35. As a 开发者, I want 在本 Team 创建/停用/再启用 VK（明文只出现一次）, so that 我能自己接入
36. As a 团队管理员或开发者, I want 看见预算和限流剩余, so that 我知道为何 402/429
37. As a 团队管理员或开发者, I want 撤掉某 Team 成员后立刻看不见它、但已发 VK 仍能打, so that 可见性和流量是两根开关

### 账本与治理行为

38. As a 管理员, I want 一次入口仍是一粒 Request, so that 换 Channel 不新开粒
39. As a 管理员, I want Request.usage 和状态来自最终 Attempt、cost 为各次有 Usage 之和, so that 失败消耗不蒸发
40. As a 管理员, I want 对客金额按当时倍率写入 Request, so that 以后改倍率不翻旧账
41. As a 管理员, I want 429/402/鉴权失败也 append Request（token/cost 0）, so that 拒绝不会从账上消失
42. As a 管理员, I want 熔断按「会不会 failover」算成功, so that 调用方 400 不会把好 Channel 熔断
43. As a 管理员, I want 半开只放行 1 个真实探测、其余视作 open, so that 不会雪崩
44. As a 管理员, I want Health 和限流都在进程内、重启清空, so that Redis 不是网关依赖
45. As a 管理员, I want 配置只能停用不能物理删除, so that Request 和 Attempt 快照不指空气

## Implementation Decisions

- 单进程、对外 HTTP 一条缝、Provider 一条出站缝。测试仍只打 HTTP，Provider 用 fixture。不引入 Redis。
- 企业是隔离边界。集团不是实体。内部公司与客户公司同一套墙。
- Team 是成本桶。P1 `projects` 改名为 `teams`，加 `enterprise_name`。VK 绑 Team。报表：企业 → Team × Model × 日（上海）。
- `x-fabric-context.team_id` 缺省或一致则过；不一致拒绝。出现 `project_id` → 拒绝（P2 不消费 Space 项目）。
- Provider = 家族 + base URL。Provider Key 属于 Provider。Channel = (Model, Provider Key) + 权重 + 优先级 + 成本价。同一对只能一条。只有超级管理员碰线路。
- 挑选：优先级从高到低（数字越大越先），同级加权；失败的本请求不抽回；权重 0 = 备路。
- Failover：写出任何响应（状态行/头/体）之前；触发 429/5xx/401/403/404/超时/传输失败；400/422 不换。最多 3 次 Attempt，单次默认 30s。
- Request 含 Team、企业、Usage、cost、对客金额、Attempt 快照。禁止 UPDATE。
- 预算按成本：Team 可配，企业可选，无平台总闸。独立跳闸。事后扣减。没配 = 无限。
- 限流：per-VK + per-Team RPM，按入口计 1，先于预算，先于上游。
- 对客金额 = 全局倍率 × cost，写入当时 Request。企业/团队控制台只展示成本。
- User 恰好一个角色。团队管理员/开发者 ↔ Team 多对多。无注册、无 VK 审批。
- 三套路由：`/platform`、`/enterprise`、`/team`。P1 `/admin` 登录改到角色对应控制台；种子超级管理员进平台控制台。
- 种子：一个超级管理员（沿用 `admin` / `fabric-admin`）、一个种子企业、一个种子 Team `demo`、现有种子 Model/价格迁到一条 Channel，保证 P1 透传测试在改名后仍能跑。
- 遵守 `CONTEXT.md` 与上列 ADR。

## Testing Decisions

- 缝仍是对外 HTTP：网关两端点 + 三套控制台 API。不断言表结构、goroutine、进程内 map。
- Provider 出站只插 fixture。Failover / 熔断测试用可编程 fixture（按调用次数返回 500 再 200，或按 Channel 区分）。
- 覆盖：同 model 两 Channel 的 failover 与 400 不换；首字节后不换；Attempt 快照与 cost 之和；企业互相不可见；角色越权 403；429/402 不上游仍入账；半开只放一笔；倍率写入后修改不再翻旧 Request。
- P1 套件在 Team 改名后保持绿色（种子 Team、VK、透传、上海日）。

## Out of Scope

- Space 项目通信、跨 model Fallback、同 Channel 重试、改请求体、别名
- Organization/集团实体、VK 审批、Webhook、合成探测
- 企业自带 Key、每企业价表、账单、Credit、预占、平台总闸
- Adjustment、物理删除、Redis、ClickHouse、OIDC
- 修改 `archive/` 历史稿

## Further Notes

- 活文档：`CONTEXT.md`、`docs/adr/0010`–`0029`、本文件。PRD §4 与上述 ADR 冲突时以 ADR 与本 spec 为准。
- 上线条件：超级管理员能建第二家企业并隔离；同 model 两条 Channel 时人为停一条，流量走另一条；企业管理员能给 Team 加预算并看到 402；平台控制台能看见毛利。
- 下一技能：把本 spec 拆成 `.scratch/phase-2-governance/issues/` 里带阻塞边的票，然后按票 TDD。
