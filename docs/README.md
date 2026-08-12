# docs 怎么看

当前已落地的是 **KodaX Fabric 的核心模块 Token Hub**（公司内 LLM 网关 + 凭证池 + 调用审计），版本 **v0.1.0**。  
不要按文件名通读。目录按「现在能用的 / 以后想做的 / 技能登记」分开。

```text
docs/
├── README.md              ← 你在这里
├── FEATURE_LIST.md        功能进度（feature-manager，留在根上）
├── KNOWN_ISSUES.md        已知问题（issue-manager，留在根上）
├── features/              设计块（feature-manager 约定路径，勿挪）
│   └── v0.1.0.md
├── token-hub/             已落地模块：规则、公测、运维、历史版本
└── fabric/                整机愿景（大部分还没做）
    └── archive/           早期草稿，易误导
```

> 员工日常接入步骤不在这里，以网页 **「接入教程」**（`/me/guide`）为准。

---

## 按角色的阅读顺序

### 1. 刚进仓库的研发（建议 30～45 分钟）

先建立「现在系统是什么」，再碰代码。

1. 仓库根 [README.md](../README.md) — 产品一句话、怎么跑、workspace
2. **[token-hub/v0.1.0-closeout.md](token-hub/v0.1.0-closeout.md)** — 一页纸：做到哪了、明确没做啥
3. **[token-hub/pilot-charter.md](token-hub/pilot-charter.md)** — 公测唯一配置/边界口径（角色、开户、渠道、配额、安全）
4. **[token-hub/TokenHub_PRD.md](token-hub/TokenHub_PRD.md)** — Token Hub 产品规则全集（渠道硬绑定、双协议透传、不计费、工单……）
5. [FEATURE_LIST.md](FEATURE_LIST.md) → [KNOWN_ISSUES.md](KNOWN_ISSUES.md) — 进度和已知坑

然后按任务补：

- 改接口 / 调度 / 安全：回看 [token-hub/history/v0.0.1.md](token-hub/history/v0.0.1.md)（渠道硬绑定与 Relay 契约的源头）
- 发版 / 备份：[token-hub/runbook-release.md](token-hub/runbook-release.md) + [../deploy/README.md](../deploy/README.md)
- 线上排障：[token-hub/runbook-troubleshoot.md](token-hub/runbook-troubleshoot.md)

**先别读**：[fabric/](fabric/README.md) 整夹。那是整机愿景，容易把「还没做的」当成现状。尤其不要从 [fabric/archive/ProductDraft.md](fabric/archive/ProductDraft.md) 入门。

### 2. 产品 / 负责人（对齐范围）

1. [token-hub/v0.1.0-closeout.md](token-hub/v0.1.0-closeout.md) — 公测结论
2. [token-hub/pilot-charter.md](token-hub/pilot-charter.md) — 现在对员工/管理员承诺什么
3. [token-hub/TokenHub_PRD.md](token-hub/TokenHub_PRD.md) — 模块规则与边界
4. 若要谈 Token Hub 下一步：[fabric/TokenHub_VISION.md](fabric/TokenHub_VISION.md)；整机再看 [fabric/PRD.md](fabric/PRD.md)
5. 需要界面想象力时再看 [fabric/UI_DESIGN.md](fabric/UI_DESIGN.md)

[fabric/archive/ProductDraft.md](fabric/archive/ProductDraft.md) 是最早、最全的一版「AI 产能控制平面」设想，和现行 PRD 不完全同一套词。当参考，不要当合同。

### 3. 运维 / 值班

1. [token-hub/pilot-charter.md](token-hub/pilot-charter.md) — 渠道策略、配额、对接人（**配置口径**）
2. [token-hub/runbook-troubleshoot.md](token-hub/runbook-troubleshoot.md) — 报障后 5 分钟分流
3. [token-hub/runbook-release.md](token-hub/runbook-release.md) — 发布、回滚、备份恢复
4. [../deploy/README.md](../deploy/README.md) — compose / 环境变量
5. 发版或扩大使用前勾 [token-hub/release-checklist.md](token-hub/release-checklist.md)

### 4. 修现有功能 / 查「为什么代码这样」

1. [FEATURE_LIST.md](FEATURE_LIST.md) — 功能是否已收口
2. [KNOWN_ISSUES.md](KNOWN_ISSUES.md) — 是不是已知问题
3. [token-hub/TokenHub_PRD.md](token-hub/TokenHub_PRD.md) — 规则该不该改
4. 对应版本增量（只查相关章节，不必通读）：

| 想搞清楚 | 看 |
|----------|----|
| Key 渠道硬绑定、双协议、角色隔离 | [token-hub/history/v0.0.1.md](token-hub/history/v0.0.1.md) |
| 渠道命名、协议配置、Key 对管理员不可见 | [token-hub/history/v0.0.2.md](token-hub/history/v0.0.2.md) |
| 员工用量、日志正文仅管理员、日 Token 配额 | [token-hub/history/v0.0.3.md](token-hub/history/v0.0.3.md) |
| 双角色收敛、渠道统计、操作审计分页 | [token-hub/history/v0.0.4.md](token-hub/history/v0.0.4.md) |
| 基础工单 | [token-hub/history/v0.0.5.md](token-hub/history/v0.0.5.md) |
| 公测收口（文档 + 运维 + 双端验证） | [features/v0.1.0.md](features/v0.1.0.md) |

### 5. 规划新功能（还没立项时）

1. [FEATURE_LIST.md](FEATURE_LIST.md) — 当前有没有进行中的 feature
2. [token-hub/pilot-charter.md](token-hub/pilot-charter.md) §1.3 + [token-hub/TokenHub_PRD.md](token-hub/TokenHub_PRD.md) §2.2 — 明确「现在不做」
3. [fabric/PRD.md](fabric/PRD.md) — 整机目标（Token Hub + Token ROI + 可选 Commerce）
4. [fabric/HLD.md](fabric/HLD.md) — 服务拆分、数据模型、网关/计量设想
5. 立项后再写 `docs/features/<version>.md`，并回写 FEATURE_LIST

---

## 权威口径（冲突时听谁的）

| 问题 | 以谁为准 |
|------|----------|
| 公测配置、渠道/配额/开户边界 | [token-hub/pilot-charter.md](token-hub/pilot-charter.md) |
| Token Hub 产品规则（做什么、不做什么） | [token-hub/TokenHub_PRD.md](token-hub/TokenHub_PRD.md) |
| 员工怎么接 Claude Code / Cursor | 网页 `/me/guide`（比 charter 新则改网页并回写 charter） |
| 已做完哪些 feature、下一个是谁 | [FEATURE_LIST.md](FEATURE_LIST.md) |
| 已知缺陷 | [KNOWN_ISSUES.md](KNOWN_ISSUES.md) |
| 整机愿景（尚未全部落地） | [fabric/PRD.md](fabric/PRD.md) / [fabric/HLD.md](fabric/HLD.md) |
| 发布步骤、备份恢复 | [token-hub/runbook-release.md](token-hub/runbook-release.md) |
| 线上故障怎么查 | [token-hub/runbook-troubleshoot.md](token-hub/runbook-troubleshoot.md) |
| 版本发布说明 | 根目录 [CHANGELOG.md](../CHANGELOG.md) |

`TokenHub_PRD.md` 页眉仍写「基线 v0.0.5、待部署」——规则正文仍有效，**运行版本以 v0.1.0 / `package.json` 为准**。  
历史文件名里的 TokenHub，只表示模块；产品与仓库名是 **KodaX Fabric**。生产域名、镜像、库名可以继续带 `tokenhub`。

`FEATURE_LIST.md`、`KNOWN_ISSUES.md`、`docs/features/` 留在 `docs/` 根上，是 feature-manager / issue-manager 的约定路径，不要挪进 `token-hub/`。

---

## 全量索引

### 建议常看

| 文档 | 篇幅 | 用途 |
|------|------|------|
| [token-hub/v0.1.0-closeout.md](token-hub/v0.1.0-closeout.md) | 短 | 公测收口一页纸 |
| [token-hub/pilot-charter.md](token-hub/pilot-charter.md) | 中 | 公测章程；管理员配置/边界 |
| [token-hub/TokenHub_PRD.md](token-hub/TokenHub_PRD.md) | 长 | 已落地模块的产品规则 |
| [FEATURE_LIST.md](FEATURE_LIST.md) | 短 | Feature 进度总表 |
| [KNOWN_ISSUES.md](KNOWN_ISSUES.md) | 短 | 已知问题 |
| [token-hub/runbook-release.md](token-hub/runbook-release.md) | 中 | 发布、回滚、备份 |
| [token-hub/runbook-troubleshoot.md](token-hub/runbook-troubleshoot.md) | 中 | 值班排障 |
| [token-hub/release-checklist.md](token-hub/release-checklist.md) | 中 | 发版/扩大使用前回归 |
| [../deploy/README.md](../deploy/README.md) | 短 | 部署与环境 |

### 愿景（整机尚未落地）

| 文档 | 篇幅 | 用途 |
|------|------|------|
| [fabric/TokenHub_VISION.md](fabric/TokenHub_VISION.md) | 中 | PRD 里 Token Hub 愿景的功能表 + 人话版（不是现网） |
| [fabric/PRD.md](fabric/PRD.md) | 长 | Fabric 整机需求：Token Hub + Token ROI + 可选计费 |
| [fabric/HLD.md](fabric/HLD.md) | 很长 | 架构、数据模型、网关/计量/治理设计 |
| [fabric/UI_DESIGN.md](fabric/UI_DESIGN.md) | 很长 | 整机控制台 ASCII 线框（17 个界面，远多于现网） |
| [fabric/archive/ProductDraft.md](fabric/archive/ProductDraft.md) | 极长 | 早期完整设想；和现行 PRD 有用词差异 |

### 历史版本（按需查阅，不要当入门）

| 文档 | 当时加了什么 |
|------|----------------|
| [token-hub/history/v0.0.1.md](token-hub/history/v0.0.1.md) | 首次规格：渠道硬绑定、双协议、角色隔离 |
| [token-hub/history/v0.0.2.md](token-hub/history/v0.0.2.md) | 渠道可运维、Key 对管理员不可见 |
| [token-hub/history/v0.0.3.md](token-hub/history/v0.0.3.md) | 用量可视化、日 Token 配额、日志正文权限 |
| [token-hub/history/v0.0.4.md](token-hub/history/v0.0.4.md) | 去掉第三角色，只留员工/管理员 |
| [token-hub/history/v0.0.5.md](token-hub/history/v0.0.5.md) | 基础工单 |
| [features/v0.1.0.md](features/v0.1.0.md) | 公测收口设计（E1～E10） |

---

## 一张图

```text
你是谁？
├─ 写代码 / 刚来
│    根 README → token-hub/closeout → charter → TokenHub_PRD → FEATURE_LIST / KNOWN_ISSUES
├─ 值班 / 发版
│    token-hub/charter → troubleshoot 或 runbook-release → deploy/README
├─ 谈「Fabric 以后做成什么样」
│    fabric/PRD → HLD →（可选）UI_DESIGN / archive/ProductDraft
└─ 查某次改动的原始约定
     token-hub/history/v0.0.x · features/v0.1.0.md
```
