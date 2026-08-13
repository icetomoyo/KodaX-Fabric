# Token Hub 版本切片（已冻结）

冻结日期：2026-08-13。**2026-08-13 修订**：按 CTO 口径同时遵守 [PRD.md](PRD.md) 与 [HLD.md](HLD.md)。改切法必须先改本文，再动 `FEATURE_LIST`。

- 产品行为：[PRD.md](PRD.md) §3（Token Hub）
- 架构与已定技术决策：[HLD.md](HLD.md) §1、§3、附录 B（网关 Go、零转换、V1 单进程、PG + Redis）
- 功能点与**手测依据**：[TokenHub_VISION.md](TokenHub_VISION.md)（从 PRD §3 抽出的 57 点 + 人话版）
- 进度：[FEATURE_LIST.md](FEATURE_LIST.md)（当前只登记 0.0.1）

现网 Node 试点按**对照实现**冻住，不是 HLD 基线。新序列从 `0.0.1` 按 HLD 实体 **VirtualKey → ChannelPool → Channel** 重开（本版池里可以只有一条渠）。

---

## 0.1.0 独立部署标准

到 `0.1.0` 必须同时成立（不再加新能力点，只收口）：

1. **HLD V1 形态**：Go 单进程承载 Gateway（可同进程挂尚未做满的 Admin/Metering 模块位）；依赖 **PostgreSQL + Redis**。ClickHouse / S3 / 计费引擎属 PRD §4–§5 / HLD §4–§5，**不进 Token Hub 0.1.0**  
2. 对外：双端点 + `fab-` VK；调用方碰不到 Provider Key（HLD §3.2 / §7.1）  
3. VirtualKey → ChannelPool → Channel；同协议内可 failover；**禁止**调用方钥匙硬绑单渠  
4. 限流 + 熔断 + VK 预算，至少各有一种硬拒绝（HLD §3.5 / §3.6）  
5. 能发布/回滚/备份，`/health`，管理员能配 Provider / Channel / Pool / VK  
6. Claude Code 与 Cursor 用**同一把** VK 走通  

`0.1.0` = PRD Phase 1 + Phase 2 = HLD §3 网关层可独立部署。Token ROI、Commerce、多租户控制台全量（HLD §4–§6、React 控制台）不挡本模块 0.1.0。

---

## 切片表（8 + 收口）

每个 `0.0.x` 结束时，必须能演示多出来的那一种行为。功能点编号 = [TokenHub_VISION.md](TokenHub_VISION.md) 总表 `#`。手测按该版「覆盖功能点」逐条对照人话版。

| 版本 | 交付（人话） | 覆盖功能点 | 手测抓手 |
|------|----------------|------------|----------|
| **0.0.1** | 改 Base URL，OpenAI / Anthropic 原样过；SSE 能流、能停；厂家 `usage` 记账。模型预留 VK→池 | 1, 2, 5, 7, 8, 53, 55, 56 | Cursor 走 Chat Completions、Claude Code 走 Messages；停生成上游停；响应头限流不吞 |
| **0.0.2** | 官方 Key 加密入库；同一家多把轮转；401/额度能停用 | 10, 12, 13, 14 | 管理员录入两把官方 Key，打流会摊；废 Key 不再被选 |
| **0.0.3** | 调用方只拿 `fab-…`；**一把 VK 两个端点都能用**；可限模型、可过期 | 6, 16, 20, 22 | 同一把 VK 调 GPT 端点与 Claude 端点；过期/模型不在白名单被拒 |
| **0.0.4** | 同模型多路；加权、主备、同模型换路重试；路由可审计 | 25, 26, 32, 33, 34, 35, 38, 39, 40 | 主路挂了走备路；400 不重试；能回放选了哪条路 |
| **0.0.5** | VK → 项目/团队 → 渠道池；premium/standard/bulk；团队不串官方 Key | 15, 17, 21, 27 | 两把 VK 走不同池；A 团队打不到 B 的官方 Key |
| **0.0.6** | Key / Provider 硬拒绝 + 突发桶；摘病路、半开、池内切流 | 19, 28–31, 42（先两维）, 43, 46–49 | 超 RPM 立刻 429；连续失败的渠被摘掉再半开 |
| **0.0.7** | VK 月预算软/硬；边流边估 Token，结束用官方 usage 校准 | 18, 54 | 快到额提醒，到额硬拒；长流过程中用量在涨 |
| **0.0.8** | Prompt/响应缓存；申请审批、IP 白名单、Key 轮换 | 11, 23, 24, 50–52, 57 | 重复确定性问题可命中缓存；未审批/非白名单 IP 调不成 |
| **0.1.0** | 独立部署收口：镜像/compose、备份、健康、双端验收、模块文档 | 无新功能点 | 对照上文 6 条标准勾选 |

**本版不单独开号、写进相邻版验收即可**

| 点 | 处理 |
|----|------|
| #7 禁止跨协议 Fallback、#57 流式不缓存响应 | 约束，并进 0.0.1 / 0.0.8 |
| #3 vLLM | 0.0.4 的一条 OpenAI 兼容渠 |
| #4 `fabric_context` | 0.0.3 预留头，给后面 ROI |
| #9 Embedding/Batch | 0.2 |
| #36 / #37 / #41 / #44 / #45 | 0.2 或 Token ROI |

---

## 登记规则

- `FEATURE_LIST` **一次只登当前要做的那一版**（001–005 已 Completed；下一版要做时再 Add）。  
- 上一版 Completed 后再 Add 下一版。  
- 设计块六节由 `/to-spec`、`/to-tickets` 填，不要在 Add 时写实现。
