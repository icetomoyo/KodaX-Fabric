1、超级管理员：SaaS平台的管理员
2、管理员：海致科技，海致星图，海致甲辰，客户，把公司也当一个 SaaS 用户去处理
3、项目管理员：VK审批
4、开发者/员工：VK使用

# Token Hub 文档对照与落地重判

## 文档各管什么

| 文件 | 角色 | 该怎么读 |
|------|------|----------|
| **PRD.md** | 整机愿景 | Token Hub + Token ROI + Commerce + 四角色 17 屏。文首已声明现网不是这个范围 |
| **HLD.md** | 目标架构 | Go / 零转换 / V1 单进程 / PG+Redis 已定；ClickHouse、S3、计量工人、四套账本、RLS 是后面的层 |
| **token-hub-slices.md** | 闸门 | 已冻结的 Hub 切法。0.1.0 = Hub 可独立部署；ROI / Commerce / 超管不进本序列 |
| **TokenHub_VISION.md** | Hub 手测表 | 从 PRD §3 抽出的 57 点。ROI / 计费 / 五档保存明确划出 |
| **FEATURE_LIST.md + features/v*** | 进度账 | 001–011 全 Completed，当前发布 v0.1.3，无 Planned |
| **UI_DESIGN.md** | 愿景线框 | 17 屏草稿；现网是三角色共用 /admin 壳 |
| **KNOWN_ISSUES.md** | 缺陷账 | 001–005 已修，无 Open |
| **PRD-feasibility-analysis.md** | 仅基于 PRD 的可落地性 | 方向对，但没对照切法和现网，有几处要改 |

> Agents.md 与切法一致：超管、多租户、Commerce、Token ROI、Embedding/Batch 不进当前序列，除非先改切法。

---

## 重判：可以落地，而且 Hub 已经落地了一截

只读 PRD 时的判断是「分层落地」。对照切法和设计块之后，分层已经发生过了：

- **Token Hub 热路径**（PRD §3 的主干）：0.0.1–0.1.0 按刀做完，0.1.1 修回归，0.1.2–0.1.3 补单一企业控制台。这不是规划，是已发布。
- **Token ROI**（PRD §2 / HLD §4）：设计有了，代码序列没开。最大风险仍是分类数据，不是公式写不出来。
- **Commerce**（PRD §4.6–4.10 / HLD §5）：技术简单，切法明确后置；商业前提（转售条款、定价数据）PRD 和 HLD 都没答。
- **治理全量**（五档保存、Legal Hold、多租户 RLS）：组织树只够 VK 绑项目/团队，保存策略和 SaaS 隔离没做。

**一句话**：PRD 当排期会失败；当愿景、用切法当闸门，Hub 这条路已经被验证过。下一阶段的失败模式换成「把 HLD §4 的分类器直接当 PRD 五分类实现」。

---

## PRD 模块对照现网

### 已接近 PRD §3 的部分（Hub）

| PRD | 切法 / 版本 | 现网实际（以设计块为准） |
|-----|-------------|-------------------------|
| 双端点零转换、SSE、限流头透传 | 0.0.1 | 已交付；禁止跨协议 fallback |
| 官方 Key 加密、多 Key 轮转、失效停用 | 0.0.2 | 已交付 |
| fab- 一把两端口、模型白名单、过期 | 0.0.3 | 已交付；x-fabric-context 只预留 |
| 同协议多渠、权重、主备、审计 | 0.0.4 | 已交付；vLLM 当作 OpenAI 兼容渠 |
| VK → 项目 → 团队 → 池 | 0.0.5 + 0.1.2 | 热路径隔离 + 人侧三角色都有 |
| 限流硬拒绝、熔断半开 | 0.0.6 | 只做了 VK + Provider 两维，不是 PRD 四维 |
| VK 预算软/硬、流式估 Token | 0.0.7 | 单位是 Token，不是人民币；无预占、无组织瀑布 |
| 缓存、审批、IP 白名单、Key 轮换 | 0.0.8 | 流式响应不缓存 |
| 独立部署 | 0.1.0 | compose + PG + Redis；限流/缓存/预算仍在进程内 |
| 三角色控制台 | 0.1.2 / 0.1.3 | /admin 裁菜单 + 自助改资料；不是 17 屏 |

**VISION 里明确推后的点**：#9 Embedding/Batch，#36/#37 延迟/成本优先，#41 ROI 选路，#44/#45 排队与降级换模型。#42 的 team/project 维、#47 主动 ping 上游，设计块里也写了本版不做。

### PRD 写了、现网基本没有的部分

| PRD | HLD 怎么说 | 现网 |
|-----|------------|------|
| Token 五分类 + 北极星 ROI | §4.1 用 role 启发式（system/user/assistant/tool） | 未做 |
| 文件级归因、浪费检测 | §4.2 / §4.5 异步批处理 | 未做 |
| 四套账本、Budget Waterfall、预占、对账 | §4.3 / §4.4，依赖 Redis Lua + ClickHouse | 只有 VK 月 Token 闸 |
| Pricebook / Credits / 三层计量 | §5，独立计费引擎 | 明确不进 0.1.x |
| 五档保存、TTL、归档、Legal Hold | §6.3，S3 + ClickHouse | 未做 |
| 超管、Tenant、17 屏、ROI 大盘 | §6.1 / UI_DESIGN | 不做；现网 9 个左右菜单项 |
| 网关开销 P99 < 50ms、计量误差 < 1%、故障转移 < 5s | §10.1 写成目标 | 无对应验收；流式无 usage 时用估算 |

---

## 先前那份「只读 PRD」分析，哪些要改

PRD-feasibility-analysis.md 的总方向仍对，对照其他文档后有五处要修正：

1. **「V1 范围过大、要打 Phase 标签」**  
   Hub 已经用切法打过了。缺标签的是 PRD 正文自己，不是工程没分层。再提「保护 Phase 1」已经过时——Phase 1/2 按切法定义已经收口。

2. **「§11.4 有 Phase 1–5 路线」**  
   现用 PRD.md 没有 §11.4，只到 §11.3。那是分析报告写穿了。

3. **Token 分类缺口比「PRD 没写降级」更尖锐**  
   HLD §4.1 已经给了一个降级：按协议 role 分类，并把 assistant 一律算 Context、把 image 算 Injected。这和 PRD 的语义五分类（历史 / 工具结果 / 注入文件）不是同一件事。若按 HLD 实现，Agent 流量里大段仓库上下文会进 User Query（权重 1.0），Tool Result（0.2）会系统性地被算成低价值——可行性报告里警告的「Agent ROI 被压低」在 HLD 里已经被写进默认算法。

4. **流式 + 计量冲突，现网用更窄的口径绕开了**  
   0.0.7 预算按 Token 不按元，结束用厂家 usage，没有 usage 才用估算。PRD §9.2 的「误差 < 1%」仍然和「无 usage 用估算」打架，但现网没有承诺人民币精度。SLA 冲突还在文档里，不在已发布行为里。

5. **Redis / ClickHouse 不能再按 PRD/HLD 字面当成已选基线**  
   切法要求 compose 里有 Redis；0.1.0 明确不把限流/缓存/预算迁到 Redis。ISSUE_005 也写了：Redis 挂了热路径还能转。HLD 的「四维令牌桶 Lua 原子操作」「计量进 ClickHouse」是目标架构，不是 v0.1.3 事实。

---

## 文档之间已经不一致的地方

这些是分析结论，也是文档债：

| 不一致 | 说明 |
|--------|------|
| 切法未收 0.1.3 | token-hub-slices.md 冻在 0.1.2，还写「FEATURE_LIST 当前只登记 0.0.1」。进度账已经有 011 / v0.1.3 |
| KNOWN_ISSUES.md 过期 | 文首仍写「当前发布 v0.1.0」「不建议判定生产完全落地」；修复栏写 unreleased。按 FEATURE_LIST，001–005 已随 0.1.1 发出 |
| HLD 身份模型 vs 现网 | 文首声明了 operators + 手机号，正文仍是 users + email、/api/v1。现网管理面是 /console/v1 |
| HLD「V1 最小部署」含 ClickHouse | 切法和 0.1.0 设计块写死：ClickHouse / S3 / 计费引擎不进 Token Hub 0.1.0。HLD §9.1 最小部署仍画了 ClickHouse |
| PRD 预算是 ¥ + 瀑布，现网是 VK Token | PRD §3.2 / §4.2–4.4 与 FEATURE_007 单位、层级都不同 |
| PRD #31 池级容量 vs 006 | 006 明确不做池级 RPM 总闸，避免变成第三维限流 |
| UI_DESIGN / PRD §10 vs 0.1.2 菜单 | 愿景有预算/ROI/用量/Run Explorer/限流/保存策略；现网是总览、用户、上游、池、渠、VK、团队项目、审计、文档、我的资料 |
| 北极星指标无处可算 | PRD §8 的 Token ROI 依赖分类；分类未做，控制台总览也不该假装有 78% ROI |

---

## 仍然成立的风险（按现在该不该挡下一刀排序）

1. **Token 分类是护城河，也是最大产品洞（未解）**  
   网关看到的是 messages[]，不是「这段是注入的仓库」。HLD 的 role 启发式能交差，但交出去的数字不是 PRD 卖的那种 ROI。要进 ROI 序列，应先在切法里写死 V1 分类口径，而不是直接开「ROI 仪表盘」feature。

   可行的诚实口径（文档里还没写成闸门）：
   - 协议可确定：system / 非 system 输入 / tool_result / tool_call / thinking（若 usage 有）/ 其余输出
   - 五分类语义标签走 x-fabric-context，未标则 ROI 标低置信度
   - 权重表版本化、可配置；仪表盘同时给未加权比例
   - type_weight ≥ 0.3 算有价值 会把 Tool Result 永远打成浪费，Agent 场景要先改规则再算北极星

2. **HLD 计量层默认依赖尚未存在的存储**  
   分类、归因、浪费、ROI 聚合都写在 ClickHouse 上。现网只有 PG。开 ROI 第一刀要么先引入 ClickHouse，要么承认 V1 聚合走 PostgreSQL——这是架构决策，不是页面工作。

3. **Commerce 仍是商业问题不是工程问题**  
   切法把它排除是对的。上游 TOS / 转售合规、split 比例没有真实用量可回测，这两件事 PRD、HLD、切法都没答。

4. **文件级归因覆盖率会被宣传夸大**  
   PRD §2.4 自己写了限制（只要标准 tool_use），§11 仍当普适卖点。再叠加 Zero Retention：路径算不算可保存元数据，PRD/HLD 都没划清。现网还没做，开做前要先改文案预期。

5. **热路径状态仍在进程内**  
   HLD「网关无状态、水平扩展零障碍」与 0.1.0「Redis 只探活」矛盾。单副本没问题；真要多副本网关，限流/熔断/预算会漂。这不挡现在的 idle，但挡「上 K8s 多副本」叙事。

---

## 内部一致性（补上现网视角）

| 检查 | 结果 |
|------|------|
| 零转换 vs fallback | 一致，切法和 004 都禁跨协议 |
| 不调用 LLM 做优化 | 一致，浪费/ROI 路由都写统计方法 |
| 调用方只持 fab- | 一致，且是已测行为 |
| PRD 软硬预算 vs 007 | 行为形似，单位和层级不同 |
| PRD 四维限流 vs 006 | 刻意缩成两维，文档有记 |
| HLD Redis 热状态 vs 0.1.0 | 目标 vs 事实，未在 HLD 正文改掉 |
| 愿景 17 屏 vs 现网三角色 | 各文文首已声明，执行纪律是好的 |
| 切法冻结 vs 0.1.3 | 账和闸门不同步 |

---

## 现在处在哪、下一刀不该是什么

按进度账：v0.1.3 已发布，无 InProgress / Planned / ready issue，阶段是 **idle**。

Token Hub 按切法定义的「可独立部署」已经收口。0.1.2/0.1.3 是控制台补完，不是新能力面。切法里 Hub 还没做的只剩标注为 0.2 或 Token ROI 的点。

因此：

- **不该**直接「做一个 ROI 仪表盘」或「把 17 屏补齐」——分类口径和存储都没进切法。
- **不该**在 FEATURE_LIST 里登记 Commerce / 超管 / Embedding，除非先改 token-hub-slices.md。
- 若继续产品主线，应先改切法，写清下一版交付是哪一种：补齐 Hub 缺口（team/project 限流、主动探测、热状态迁 Redis），还是开 Token ROI 的诚实 V1（粗分类 + 置信度 + 先 PG 还是先上 ClickHouse）。
- 若先收文档，优先：切法补 0.1.3、KNOWN_ISSUES 改到 v0.1.3、PRD 给能力打阶段、HLD 把 V1 事实（operators、/console/v1、进程内限流、无 ClickHouse）从目标架构里拆开。

按仓库约定，下一句命令仍是：

> **下一步：先改 docs/token-hub-slices.md，写清下一版交付，再「添加一个 feature：…」**

先前那份可行性报告不必作废，但不宜再当唯一依据——它没看见 Hub 已发布，也没看见 HLD 分类器已经在用另一套语义。需要的话可以把这份对照写进 PRD-feasibility-analysis.md，或先改切法里的「下一版」表述。