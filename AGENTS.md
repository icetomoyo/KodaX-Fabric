# AGENTS.md

本仓库按 [docs/FEATURE_LIST.md](docs/FEATURE_LIST.md) 持续开发。AI 先读本文「当前阶段」，再动代码。

技能正文：`~/.claude/skills/<name>/SKILL.md`  
导读：[guide_skills/README.md](guide_skills/README.md) · [guide_skills/skills_list.md](guide_skills/skills_list.md)  
上游：[icetomoyo/CodingSkills](https://github.com/icetomoyo/CodingSkills)

---

## 当前阶段（每次推进必须改这里）

> 用户问「下一步 / 下一步做什么 / next」时：**先读本表**，再对照 FEATURE_LIST 与设计块。表和文件不一致，以 FEATURE_LIST + 设计块为准，当场改本表，再回答。

| 项 | 值 |
|----|-----|
| 更新于 | 2026-08-14 |
| 当前发布 | **v0.1.2** |
| 进行中 feature | **011** 各角色自助改资料与密码（InProgress，v0.1.3） |
| 进行中 issue | 无 |
| 阶段 | `complete` |
| 下一步命令 | `完成 feature 011` |
| 说明 | FEATURE_011 #1–#2 已实现并提交。下一步结案（可选先 `/human-test-guide`）。 |

**回答格式（只回命令，可附一句理由）：**

```
下一步：添加一个 feature：<一句话描述>
```

若下一刀尚未写入切法，先说：

```
下一步：先改 docs/token-hub-slices.md，写清下一版交付，再「添加一个 feature：…」
```

---

## 项目怎么干

1. **切法是闸门。** 改版本切片必须先改 `docs/token-hub-slices.md`，再动 FEATURE_LIST。切法遵守 `docs/PRD.md` + `docs/HLD.md`。手测对照 `docs/TokenHub_VISION.md`。
2. **FEATURE_LIST 是进度账。** 一次只推进当前这一刀。上一版 Completed 后再 Add 下一版。Add 时不写实现。
3. **人驱动构建链。** 登记完不自动往下跑。人（或用户说「下一步」）敲下一刀命令，每步产物进 `docs/features/v{VERSION}.md` 设计块。
4. **报 bug 走另一条链。** 新功能 → `feature-manager`；缺陷 → `issue-manager`。不要混。

### 新功能

```
添加一个 feature：…          →  Planned，建空设计块
开始这个 feature             →  InProgress，设计块 6 节骨架就绪
/to-spec                     →  综合 spec → 设计块 1–4、6 节
/to-tickets                  →  垂直切片票 → 设计块「实现步骤」
/implement                   →  按票 tdd + 双轴 review + 提交
/human-test-guide            →  可选，docs/test-guides/
完成 feature NNN             →  Completed，填 Released
/smart-release               →  CHANGELOG / 打版本
```

### 修 bug

```
记录这个 bug：…              →  Open / needs-info / ready
难 bug：排查一下             →  diagnosing-bugs（先建能红的循环）
/implement                   →  修 + 回归 + review + 提交
resolve NNN                  →  Resolved
/human-test-guide            →  可选，回归指导
```

对齐想法、不走上述链：`/grill-me`。换会话：`/handoff`。

---

## 「下一步」怎么答

1. 读上文「当前阶段」。
2. 打开 `docs/FEATURE_LIST.md`：有没有 `InProgress` / `Planned`。
3. 若有进行中 feature，打开其 Design 链接，看设计块头部的 Spec / Tickets 状态。
4. 若走 issue，打开 `docs/KNOWN_ISSUES.md`，看最高优先级 `ready`。
5. 用下表映射**一条**命令。不要一次甩整条链。
6. 本回合若推进了阶段，同步改「当前阶段」表。

| 阶段 | 怎么判断 | 下一步命令 |
|------|----------|------------|
| `idle` | 无 Planned、无 InProgress、无 ready issue | `添加一个 feature：<描述>`（切法未写则先改 `docs/token-hub-slices.md`） |
| `planned` | FEATURE_LIST 有 Planned | `开始这个 feature` 或 `开始 feature NNN` |
| `spec` | InProgress，设计块未综合 spec | `/to-spec` |
| `tickets` | spec 已综合，实现步骤未批准/未写入 | `/to-tickets` |
| `implement` | 票已写入，尚未全部 Done | `/implement` |
| `test_guide` | 票已 Done，用户要手测清单 | `/human-test-guide` |
| `complete` | 实现已提交，FEATURE_LIST 仍 InProgress | `完成 feature NNN` |
| `release` | 本版 feature 均 Completed，CHANGELOG 未收口 | `/smart-release` 或 `更新 changelog` |
| `issue_triage` | 有 Open / needs-info | 先补复现，转 `ready` |
| `issue_hard` | ready 且难复现/性能 | `排查一下`（diagnosing-bugs） |
| `issue_fix` | ready 且根因清或简单缺陷 | `/implement` |
| `issue_resolve` | 代码已修，issue 未 Resolved | `resolve NNN` |

---

## 推进后如何改「当前阶段」

同一回合内改本文件顶部表格，不要攒着：

| 刚做完 | 阶段改为 | 下一步命令写成 |
|--------|----------|----------------|
| 改完切法、尚未 Add | `idle` | `添加一个 feature：…` |
| Add Feature | `planned` | `开始这个 feature` |
| Start Feature | `spec` | `/to-spec` |
| `/to-spec` 写完 | `tickets` | `/to-tickets` |
| `/to-tickets` 批准落盘 | `implement` | `/implement` |
| `/implement` 提交 | `complete`（或先 `test_guide`） | `完成 feature NNN` |
| Complete 且本版未发 | `release` | `/smart-release` |
| `/smart-release` 完成 | `idle` | `添加一个 feature：…` |
| Add Issue | `issue_triage` 或 `issue_fix` / `issue_hard` | 对应命令 |
| Resolve Issue | 回到当时的 feature 阶段，或 `idle` | 按表重算 |

「进行中 feature / issue」填 ID + 标题。「说明」只写一句话：现在卡在哪、下一刀为什么是这条命令。

---

## 硬约束

- 同时遵守 PRD 与 HLD。网关 Go、零转换、V1 单进程、PG + Redis。
- Token Hub 热路径：调用方只持 `fab-` VK；禁止跨协议 fallback；流式响应不缓存。
- 超管 / 多租户 / Commerce / Token ROI / Embedding·Batch **不进当前序列**（除非切法先改）。
- 设计块 6 节由 `/to-spec`、`/to-tickets` 填，Add / Start 不写实现。
- `/implement` 在预先确认的 seam 上 tdd；`code-review` 双轴（Standards + Spec），评完出报告再改。
- 已有产物（FEATURE_LIST、设计块、KNOWN_ISSUES、CHANGELOG）是事实源；交接文档只引路径。

---

## 文档地图

| 文件 | 用途 |
|------|------|
| [docs/FEATURE_LIST.md](docs/FEATURE_LIST.md) | 进度账：版本、状态、设计链接 |
| [docs/features/vX.Y.Z.md](docs/features/) | 该版叙事 + 每条 feature 的 6 节设计块 |
| [docs/token-hub-slices.md](docs/token-hub-slices.md) | 版本切法（先改这里再登记） |
| [docs/PRD.md](docs/PRD.md) | 产品行为 |
| [docs/HLD.md](docs/HLD.md) | 架构与已定技术决策 |
| [docs/TokenHub_VISION.md](docs/TokenHub_VISION.md) | 功能点 + 手测人话 |
| [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) | 缺陷账 |
| [CHANGELOG.md](CHANGELOG.md) | 已发布说明 |
| [docs/archive/](docs/archive/) | 历史文件；不要当入门或实现依据 |
| [guide_skills/README.md](guide_skills/README.md) | 每条命令怎么跑 |
