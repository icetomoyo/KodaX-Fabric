# Claude Skills 教程

本目录总结本机 `~/.claude/skills/` 下的全部 CodingSkills（共 16 个）。

这套 skill 的目标不是「让 agent 更会写代码」，而是：**从一个随机性系统里逼出可预测的过程**——每次走同一套步骤，产出落在同一批文件里，人在关键闸门上拍板。

来源目录：`~/.claude/skills/`  
本教程只讲 Claude 这套，不含 Grok 内置 skill、也不含 Codex 的 `deploy-kodax-fabric`。

---

## 1. 先记住两件事

### 1.1 两种调用方式

| 类型 | 怎么触发 | 代价 | 适合什么 |
|------|----------|------|----------|
| **模型调用** | 用自然语言说意图，agent 自己匹配 | 每个 turn 都占上下文 | 必须自动出现、或其他 skill 会调用它 |
| **用户调用** | 人敲 `/skill-name` | 你得记得它存在 | 只在人明确发起时跑，避免误触发 |

模型调用 skill 的描述里会写「当用户想……时使用」。用户调用 skill 会设 `disable-model-invocation: true`，agent 默认看不见。

**不知道该用哪个时，先说场景，或敲 `/which-skill`。**

### 1.2 两条主链，人驱动

skill **不会自动把整条链跑完**。登记完之后，人按顺序敲下一步。每步产物进设计文档，人 review 后再往下。

```
新功能（构建链）
feature-manager(add)
  → /to-spec
  → /to-tickets
  → /implement          （内部：tdd + code-review + 提交）
  → /human-test-guide   （可选）
  → feature-manager(complete)
  → /smart-release

修 bug（修复链）
issue-manager(add)
  → 难 bug：diagnosing-bugs
  → /implement          （内部：tdd + code-review + 提交）
  → issue-manager(resolve)
  → /human-test-guide   （可选，回归）
```

对齐想法、不走上述流程时：`/grill-me`。  
换会话接着干：`/handoff`。

---

## 2. 全表速查

### 模型调用（自然语言即可）

| Skill | 一句话 | 典型说法 |
|-------|--------|----------|
| `feature-manager` | 管 FEATURE_LIST.md + feature 生命周期 | 「加个功能」「开始开发」「完成功能」 |
| `issue-manager` | 管 KNOWN_ISSUES.md + issue 生命周期 | 「有个 bug」「记录这个问题」 |
| `grilling` | 质询原语：一次一问，带着推荐答案 | 「对齐需求」「质询一下」「理清思路」 |
| `tdd` | 在预先确认的 seam 上 red → green | 「测试先行」「先写测试」 |
| `code-review` | 双轴评审：规范 + 是否忠实需求 | 「review 一下」「审查改动」 |
| `diagnosing-bugs` | 先建能红的反馈循环，再假设、探针、修 | 「为什么报错」「排查一下」「很慢」 |
| `domain-modeling` | 磨领域术语，写 CONTEXT.md / ADR | 「领域模型」「这个词是什么意思」 |

### 用户调用（建议敲 /name）

| Skill | 一句话 | 典型说法 |
|-------|--------|----------|
| `which-skill` | 导航中心，告诉你该用哪个 | `/which-skill` |
| `grill-me` | 脱离流程的一轮质询 | `/grill-me` |
| `to-spec` | 对话 + 代码 → spec，写入设计块 | `/to-spec` |
| `to-tickets` | spec → 垂直切片票（DAG） | `/to-tickets` |
| `implement` | 按票构建：tdd → review → 提交 | `/implement` |
| `human-test-guide` | 生成人工测试 / 回归指导 | `/human-test-guide` |
| `smart-release` | 同步 CHANGELOG，可选发版 | `/smart-release` |
| `handoff` | 把会话压成交接文档 | `/handoff` |
| `writing-great-skills` | 写 / 审计 skill 的方法论 | `/writing-great-skills` |

---

## 3. 场景怎么选

| 你现在想做的事 | 用这个 |
|----------------|--------|
| 不知道用哪个 | `/which-skill` |
| 加新功能、列功能、开始/完成功能 | `feature-manager` |
| 记 bug、列 issue、结案 | `issue-manager` |
| 把已有讨论收成 PRD/spec | `/to-spec` |
| 把 spec 拆成能独立开工的票 | `/to-tickets` |
| 按票写代码并提交 | `/implement` |
| 难复现 / 性能回归，先定位 | `diagnosing-bugs` |
| 只想被追问，先别写代码 | `/grill-me` |
| 评审一段 diff | `code-review` |
| 测试先行写一小片 | `tdd` |
| 术语打架、要写词汇表或 ADR | `domain-modeling` |
| 给 QA / 自己一份点点点清单 | `/human-test-guide` |
| 更新 changelog 或打版本 | `/smart-release` |
| 对话太长，换会话接着干 | `/handoff` |
| 写新 skill，或审计旧 skill | `/writing-great-skills` |

---

## 4. 产物落在哪

整套 skill 围着几份「单一事实源」转。交接文档、测试指导都只引用它们，不复制正文。

| 文件 | 谁写 | 是什么 |
|------|------|--------|
| `docs/FEATURE_LIST.md` | `feature-manager` | 功能索引 + 详情 + 版本进度 |
| `docs/features/v{VERSION}.md` | `feature-manager` / `to-spec` / `to-tickets` | 版本叙事 + 每个 feature 的 6 节设计块 |
| `docs/KNOWN_ISSUES.md` | `issue-manager` | issue 索引 + 详情 + 摘要 |
| `docs/test-guides/` | `human-test-guide` | 人工测试 / 回归指导 |
| `CHANGELOG.md` | `smart-release` | Unreleased + 已发布版本 |
| `CONTEXT.md` | `domain-modeling` | 领域词汇表（只放术语） |
| `docs/adr/` | `domain-modeling` | 难逆转、有权衡的架构决策 |
| `.agent/handoff/HANDOFF.md` | `handoff` | 下一会话的恢复索引 |

设计块路径约定：

```
docs/features/
├── v1.0.0.md
├── v1.1.0.md
└── unplanned.md
```

每个 feature 一块 `## FEATURE_{ID}: {Title}`，固定 6 节：

1. 需求概述  
2. 影响范围  
3. 技术方案  
4. 接口契约  
5. 实现步骤（`to-tickets` 填）  
6. 验收标准  

`to-spec` 写入 1–4、6；`to-tickets` 写入第 5 节；`implement` 读整块干活。

---

## 5. 逐个 skill

下面按「你实际会碰到的顺序」写，不是按目录字母序。

### 5.1 `which-skill` — 导航

用户调用。CodingSkills 的入口。

说出场景即可：「我要加个功能」「有个 bug」「想发版」。它只指路，不替你跑后面的链。

维护纪律：新增 / 改名 / 删除任何 skill，必须同步它的场景表。指向已删 skill 的导航比没有更糟。

---

### 5.2 `feature-manager` — 功能生命周期

模型调用。状态机：

```
Planned  →  InProgress  →  Completed
```

| 操作 | 你说什么 | 它做什么 |
|------|----------|----------|
| add | 「添加一个 feature：用户登录」 | 分配 ID 和版本，写入 FEATURE_LIST.md，在 `docs/features/vX.md` 建设计块 |
| start | 「开始下一个 feature」或带 ID | 确保 6 节设计块就绪，然后**只指路**，不自动跑构建链 |
| complete | 「完成 feature 001」 | 标 Completed，填 Released 版本；整版做完会提醒 `/smart-release` |
| archive / list | 「归档」「列出 in progress 的」 | 归档到 `FEATURES_ARCHIVED.md`，或按状态/优先级过滤列出 |

版本怎么定：

- 你指定 `-v` → 直接用  
- 已有 Planned 版本 → 用它  
- 否则检测当前版本，建议下一版，等人确认  

检测版本的优先级以 `smart-release` 那张表为准（`package.json` → `VERSION` → `pyproject.toml` → `Cargo.toml` → git tag）。

分类：New / Enhancement / Refactor / Internal。  
优先级：Critical / High / Medium / Low。

Start 时设计块有三种情况：

- 6 节已填 → 直接当规划输入  
- 块在但还是占位 → 规划后再填  
- 只有版本级叙事、没有 `## FEATURE_` 块 → 从叙事抽取 6 节草案，给你确认后再追加（不改原文）

报 bug 不要走这里，转 `issue-manager`。问已有功能怎么用，也不激活。

---

### 5.3 `to-spec` — 综合成 spec

用户调用。原则：**只综合，不访谈**。

从当前对话和代码库提炼一份 ≈PRD 的 spec，写入设计块 Part B。能自己查的事实自己查；真正的分叉（选 A 还是 B）才调 `grilling`。

写 spec 前先勾勒 **seam**（测试所在的公共边界），并和你对齐。优先复用现有 seam，全仓 seam 越少越好。

模板六节：

1. Problem Statement — 用户视角的问题  
2. Solution — 用户视角的方案  
3. User Stories — `作为 <角色>, 我想要 <功能>, 以便 <收益>`  
4. Implementation Decisions — 只记决策，不写易过期的文件路径  
5. Testing Decisions — 测外部行为，不测实现细节  
6. Out of Scope  

映射到设计块：

| spec 节 | 设计块 |
|---------|--------|
| Problem + Solution | 需求概述 |
| Implementation Decisions | 影响范围 / 技术方案 / 接口契约 |
| User Stories + Testing Decisions | 验收标准 |

本 skill 写完即停，不拆票。

---

### 5.4 `to-tickets` — 追踪弹拆票

用户调用。把 spec 拆成一组 **tracer bullet（追踪弹）**：窄而完整的垂直切片。

拆票规则：

- **垂直不水平**：一张票贯穿 schema → API → UI → tests，不是「先全做 API 再全做 UI」  
- **可独立 demo**：做完就能验证一条端到端行为  
- **塞进一个 context window**：一张票一个新会话能做完  
- **先 prefactor**：让后续改动变容易的重构，单独排在前面  

宽重构（改名列、改类型，爆炸半径扫全仓）不要硬塞进一张追踪弹，按 **expand → 分批迁移 → contract** 排。

每张票声明 **Blocked by**，构成 DAG。没有阻塞者的票就是**前沿**，可以立刻开工。

拆完后用编号列表给你审：Title / Blocked by / What it delivers。问粒度、阻塞边、是否该合并或再拆。**你批准前不落盘。** 批准后写入设计块「实现步骤」。

---

### 5.5 `implement` — 按票构建

用户调用。消费 spec + tickets。

1. 读设计块或 issue 详情  
2. 逐张前沿票：在预先确认的 seam 上跑 `tdd`（一红一绿）  
3. 全部票做完：跑完整测试 + typecheck + lint + build  
4. 调 `code-review` 双轴评审  
5. 通过后提交到当前分支  

完成门槛：每张票有过测试；全量检查绿；Critical/High finding 清零或你明确接受；代码已提交。

feature 链上：Start 之后、Complete 之前。  
issue 链上：负责把修复做完并提交。

---

### 5.6 `tdd` — 测试先行原语

模型调用。被 `implement`、`diagnosing-bugs` 调用。也是一份「什么是好测试」的参考。

好测试：只通过**公共接口**验证行为。代码可以推倒重写，测试不该因此红。读起来像规格：「用户能用有效购物车结账」。

**seam**：测试所在的公共边界。写任何测试前，先写下要测的 seam 并和你确认。未确认的 seam 上不写测试。

反模式：

- **实现耦合** — mock 内部、测私有方法、直接查库。重构时行为没变测试却红  
- **同义反复** — `expect(add(a,b)).toBe(a+b)`，用代码自己重算期望  
- **水平切片** — 先写完全部测试再写实现。应改成：一个测试 → 一个实现 → 再下一发  

循环规则：先红后绿；一次一片；**重构不在这个循环里**，留给 `code-review`。

---

### 5.7 `code-review` — 双轴评审

模型调用。评的是「某个固定点以来的 diff」，不是全仓。

两条轴**互不污染、不合并且列**：

| 轴 | 问的问题 |
|----|----------|
| **Standards** | 是否符合仓库规范 + Fowler 坏味道（长方法、重复、巨类、神秘命名、过深嵌套） |
| **Spec** | 是否忠实实现来源需求（issue / PRD / 设计块）；有没有越界做 spec 没要的东西 |

流程：钉住 `git diff <fixed-point>...HEAD` → 找 spec 来源（找不到就只评 Standards）→ 双轴并行 → 输出 `## Standards` 和 `## Spec`。

纪律：

- 只评 diff  
- 每条 finding 必须是「文件:行 + 问题 + 具体建议」  
- **只出报告，不替作者改代码**

---

### 5.8 `issue-manager` — 问题生命周期

模型调用。状态在优先级之外独立流转：

```
Open  →  needs-info  →  ready  →  Resolved
```

| 状态 | 含义 |
|------|------|
| Open | 刚建，还没判定信息齐不齐 |
| needs-info | 缺复现 / 环境 / 期望行为 |
| ready | 信息齐，可以修 |
| Resolved | 已修，留下 Fixed 版本和 Resolution |

只有 `ready` 能进 resolve。Open / needs-info 先补全。

| 操作 | 做什么 |
|------|--------|
| add | 生成 Title、现象/期望/复现、优先级、Introduced 版本；同时写 Index 和 Details |
| resolve | 选定 issue 后**暂停**，指路走修复链；修完再跑一次，标 Resolved，保留原问题，追加 Resolution |
| archive / list | 旧 Resolved 进 `ISSUES_ARCHIVED.md`；可按 open/resolved/优先级过滤 |

优先级：High（立刻修）/ Medium（本会话尽量修）/ Low（以后再说）。

新功能不要走这里，转 `feature-manager`。一般性「这段代码怎么工作」也不激活。

---

### 5.9 `diagnosing-bugs` — 难 bug 诊断

模型调用。硬 bug 和性能回归用。核心句：

> **Build a feedback loop. This is the skill. Everything else is mechanical.**

先拿到一条能在**这个** bug 上变红的命令，再谈假设。对着代码空想是本 skill 要防止的失败。

六个阶段：

1. **建反馈循环** — 失败测试、curl、CLI、无头浏览器、重放 trace、一次性 harness、fuzz、bisect、差分、最后才是 HITL 脚本。建出来后还要**收紧**：更快、更锋利、更确定。30 秒 flaky 几乎不如没有；秒级确定才叫 tight。  
2. **复现 + 最小化** — 确认是用户说的那个失败；一次切掉一个不承重的元素。  
3. **假设** — 先写 3–5 个可证伪假设再测，给用户看一眼排序。格式：`若 X 是原因，则改 Y 会消失 / 改 Z 会更严重。`  
4. **探针** — 一次只改一个变量。调试日志打 `[DEBUG-xxxx]` 前缀，方便收尾 grep。性能回归先量后修，别靠日志。  
5. **修 + 回归** — 有正确 seam 时调 `tdd`：最小化复现 → 失败测试 → 修 → 绿 → 再跑原始循环。seam 太浅给假信心，要记下来。  
6. **清理 + 复盘** — 探针清掉；根因写进 commit；再问一句「什么架构会挡住这个 bug」。

非确定性 bug 的目标是**提高复现率**，不是一次干净复现。50% flake 可调，1% 不行。

---

### 5.10 `grilling` 与 `grill-me` — 质询

`grilling` 是模型调用原语，逻辑只存这一处。`grill-me` 是用户调用的薄入口：你说「质询我 / grill me」，它把当前想法接上质询循环。

纪律：

1. **一次只问一个问题**  
2. **每个问题都带着推荐答案**，对方确认或修正即可  
3. **事实自查，决策才问人**  
4. **沿决策树逐分支收敛**，前置没定，不问依赖它的问题  
5. **共同理解达成之前不开始实现**

停的时候：每个分支都有答案（或显式「暂不决定」），复述一遍共同理解，你确认后结束。

`/grill-me` 无文件产物，纯对话。不限于 feature 开发。  
`to-spec` / `to-tickets` 里遇到分叉，也会调 `grilling`。

---

### 5.11 `domain-modeling` — 领域模型

模型调用。用来**改模型**，不是查词。任何 skill 读 `CONTEXT.md` 只是一行习惯；只有术语在变时才走本 skill。

会话里会做的事：

- 你的用词和词汇表冲突 → 立刻指出  
- 词模糊或重载 → 提出更精确的规范术语  
- 用具体场景压边界  
- 拿代码交叉验证「你说的」和「代码做的」  
- 术语一定型就写进 `CONTEXT.md`，不攒着批量写  

`CONTEXT.md` 是纯词汇表。ADR 很克制，三个条件同时成立才提议：

1. 难逆转  
2. 没上下文，后人会困惑「为什么这么做」  
3. 存在真实替代方案，你因具体理由选了一个  

文件懒创建：第一个术语定型时才建 `CONTEXT.md`，第一条 ADR 需要时才建 `docs/adr/`。

---

### 5.12 `human-test-guide` — 人工测试指导

用户调用。给功能验收或 issue 回归生成「人可以照着点」的文档，输出到 `docs/test-guides/`。

问自动化框架 / 单测怎么写 → 不要走这里，转 `tdd`。

完成门槛：7 类用例都要有（正向 / 负向 / 边界 / UI / 性能 / 安全 / 兼容性）；每个用例含优先级、类型、前置、步骤、预期。

文件名：

```
docs/test-guides/FEATURE_{ID}_{VERSION}_TEST_GUIDE.md
docs/test-guides/ISSUE_{ID}_{VERSION}_REGRESSION_GUIDE.md
```

步骤必须具体到「打开哪一页、输入什么、点什么、看到什么」。不要写「测试登录，看看能不能成功」。

---

### 5.13 `smart-release` — changelog 与发版

用户调用。两种用法：

1. **只同步**：「更新 changelog」— 把上次同步点之后的 commit 归类写进 `[Unreleased]`  
2. **发版**：「发布一个 patch」— 确认版本号后，按你勾选的步骤执行  

发版步骤（可多选）：

1. 更新 CHANGELOG（必做）  
2. 同步项目文件里的 version  
3. 打 git tag  
4. push commit 和 tag  
5. 创建 GitHub Release  
6. 更新文档里的版本号  

commit 前缀 → changelog 分类：`feat` → Added，`fix` → Fixed，`refactor` → Changed，`docs` → Documentation，`perf` → Performance；`test` / `chore` / `ci` 跳过。

版本检测优先级（其他 skill 也引用这一处，不另写）：

1. `package.json`  
2. `VERSION` 文件  
3. `pyproject.toml`  
4. `Cargo.toml`  
5. `git describe --tags`

检测到 monorepo 时会问：统一版本 / 只改变动包 / 手选 / 只改根。

---

### 5.14 `handoff` — 会话交接

用户调用。对话太长或要换 agent / 新会话时，压成一份交接 md。

必须包含 6 项：

1. 原始意图（创建时原样保留）  
2. 当前进度  
3. 已确定的接口 / 决策（骨架级，不含实现体）  
4. 避坑墓碑（失败过的方案）  
5. 下一步（可执行）  
6. 本会话读过 / 改过 / 建过的文件  

纪律：已有产物（PRD、FEATURE_LIST、KNOWN_ISSUES、commit、diff）**只引路径，不复制**。密钥、令牌、隐私去掉。

默认路径：`.agent/handoff/HANDOFF.md`（或仓库根 `HANDOFF.md`），会问你偏好。

---

### 5.15 `writing-great-skills` — 写 / 审计 skill

用户调用。元工具：用来写新 skill，或审计 `grilling`、`tdd`、`code-review` 等任何一个。

根原则是 **Predictability**：每次走相同过程，不要求相同输出。

写 skill 时几个关键杠杆：

- **调用方式**：只有 agent 必须自己触发、或其他 skill 必须调到它，才做成模型调用；否则设 `disable-model-invocation`，省上下文  
- **信息层级**：步骤写在 SKILL.md；详细参考推到旁边的 `.md`，用指针按需加载（渐进披露）  
- **完成判据**：每个步骤结尾写「怎样算做完」，要可核对、要紧处要穷尽，防止过早完成  
- **锚词**：用模型预训练里已有的紧凑词（seam、tracer bullet、tight、red）锚定一整片行为  
- **单一事实源**：一个含义只住一处  

审计时对着失败模式逐条看：过早完成、重复、沉淀、蔓生、空操作（相对模型默认什么都没改）、否定句（「不要想大象」会把大象拉进语境，尽量改成正面描述目标行为）。

审计只出诊断报告，不直接改被审 skill——和 `code-review` 同一条纪律。术语定义见同目录 `GLOSSARY.md`。

---

## 6. Skill 之间怎么调用

```
                    which-skill（指路）
                           │
          ┌────────────────┴────────────────┐
          ▼                                 ▼
   feature-manager                    issue-manager
          │                                 │
          ▼                                 ▼
       /to-spec                      diagnosing-bugs（难 bug）
          │                                 │
          ▼                                 ▼
     /to-tickets ──────────────────► /implement
          │                          │         │
          │                          ▼         ▼
          │                        tdd    code-review
          │                          │         │
          ▼                          └────┬────┘
  /human-test-guide ◄─────────────────────┤
          │                               │
          ▼                               ▼
 feature-manager(complete)      issue-manager(resolve)
          │
          ▼
    /smart-release

grilling  ◄── grill-me
    ▲
    └── to-spec / to-tickets 遇到决策分叉时调用

domain-modeling  — 任何 skill 改术语 / 写 ADR 时
handoff          — 与两条链正交，随时可切
writing-great-skills — 审计上面所有 skill
```

---

## 7. 一张纸走完新功能

以「控制台增加按项目筛选密钥」为例，人侧实际会说的话：

1. 「加一个功能：控制台密钥列表按项目筛选」  
   → `feature-manager` 登记 FEATURE_LIST，建 `docs/features/vX.md` 里的设计块  
2. 「开始这个 feature」  
   → 确认设计块 6 节，告知构建链  
3. `/to-spec`  
   → 综合 spec；分叉处会被质询；对齐测试 seam  
4. `/to-tickets`  
   → 审票：粒度、阻塞边；批准后写入「实现步骤」  
5. `/implement`  
   → 按前沿票 red-green，全量检查，双轴 review，提交  
6. `/human-test-guide`（可选）  
   → `docs/test-guides/FEATURE_00N_vX_TEST_GUIDE.md`  
7. 「完成 feature 00N」  
   → 状态 Completed  
8. 「更新 changelog」或「发布一个 minor」  
   → `/smart-release`

中途换会话：「交接一下」→ `/handoff`，新会话读交接文档接着从下一步敲。

---

## 8. 和本仓库的关系

KodaX-Fabric 已经按这套约定在用：

- `docs/FEATURE_LIST.md`  
- `docs/features/v0.0.1.md` … `v0.1.2.md`  
- `docs/KNOWN_ISSUES.md`  
- `CHANGELOG.md`  

所以在本仓库里说「加个功能 / 有个 bug / 开始下一个 feature」，会直接落到这些文件，而不是重新建一套。

本教程只总结 skill 怎么用。skill 正文仍以 `~/.claude/skills/<name>/SKILL.md` 为准；格式细节在各 skill 自己的 `REFERENCE.md` / `DESIGN-BLOCK-FORMAT.md` / `GLOSSARY.md`。
