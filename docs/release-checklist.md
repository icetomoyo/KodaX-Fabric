# Token Hub 发布前 / 公测回归清单（E10）

| 项 | 内容 |
|----|------|
| 用途 | **E10** 核心路径不回退；扩大公测或发版前勾选 |
| 关联 | [公测章程附录 A](pilot-charter.md#e10-titles) · [发布 runbook](runbook-release.md) · [排障](runbook-troubleshoot.md) · [接入教程](/me/guide) |
| 基线版本 | v0.0.5 → 目标 v0.1.0 |
| 测试策略 | T1：层 A 本文勾选；层 B 自动化 + 真实客户端 |

> 每次完整回归复制 **§3 实跑记录** 增加一节，或在本节表格中新增一列「Run N」。  
> **不要**在清单里粘贴完整 API Key。

---

## 1. 文档与门槛证据（层 A 索引）

| ID | 门槛 | 证据文档 | 文档已存在 | 运营签字项仍开放 |
|----|------|----------|------------|------------------|
| E1 | 可重复发布 | [runbook-release.md](runbook-release.md) | ☑ | 现场发布记录 §9 |
| E2 | 数据可托底 | runbook-release §4/§7/§8 | ☑ | ☑ 张闯 2026-08-11 演练通过 |
| E3 | 渠道策略 | [pilot-charter.md](pilot-charter.md) §4 | ☑ | — |
| E4 | 账号生命周期 | pilot-charter §3 | ☑ | — |
| E5 | 配额默认 | pilot-charter §5 | ☑ | ☑ 公测 5 万 Token/人/日 |
| E6 | 故障可感知 | [runbook-troubleshoot.md](runbook-troubleshoot.md) | ☑ | — |
| E7 | 问题入口 | pilot-charter §8 + 排障 §4 | ☑ | ☑ 张闯 / 18612243416 |
| E8 | 安全底线 | pilot-charter §6 | ☑ | — |
| E9 | 接入可自助 | `/me/guide` + charter §7 | ☑ | 新人实走 |
| E10 | 本清单实跑 | **本文 §2 + §3** | ☑ | 完整勾选含真实客户端 |

---

## 2. 回归检查项（展开）

### 2.1 基础设施与健康

| # | 检查项 | 如何做 | 通过标准 |
|---|--------|--------|----------|
| R1 | HTTPS 健康检查 | `curl -fsS https://tokenhub.haizhi.com/health` | HTTP 200，`ok: true`，postgres/redis true |
| R2 | 浏览器无证书告警 | 打开 `https://tokenhub.haizhi.com` | 可打开登录页 |
| R3 | 容器健康（主机） | `cd deploy && docker compose ps` | api/web/postgres/redis 健康（若本机可登录主机） |

### 2.2 账号与权限

| # | 检查项 | 如何做 | 通过标准 |
|---|--------|--------|----------|
| R4 | 管理员登录 | `/admin` 登录 | 进入管理端 |
| R5 | 强制改密路径 | 新号或重置后登录 | 未改密不能进业务页 |
| R6 | 员工开户 | 注册审核通过或管理员创建 | 可进 `/me` |
| R7 | 停用后不可调 | 停用员工后用其 Key 调 `/ai` | 401 / invalid_api_key 类失败 |

### 2.3 双协议客户端（核心）

| # | 检查项 | 如何做 | 通过标准 |
|---|--------|--------|----------|
| R8 | Claude Code 路径 | 建 `anthropic_messages` Key → 配 ANTHROPIC_* → 真实对话 | 有回复；「我的调用」有成功记录 |
| R9 | Cursor 路径 | 建 `openai_chat` Key → Base URL + Key → 对话 | 有回复；审计可查 |
| R10 | `/ai/models` 隔离 | 对绑定 Key 调 models | 仅绑定渠道模型；与调用一致 |
| R11 | 一客户端一 Key | 故意交叉协议应失败或不可用 | 与教程/章程一致，不跨协议静默成功 |

### 2.4 治理与入口

| # | 检查项 | 如何做 | 通过标准 |
|---|--------|--------|----------|
| R12 | 配额策略可见 | 管理端配额 / 员工详情 | 日 Token 上限有值；与章程评审一致或已记录 |
| R13 | 工单 | 员工提交 + 管理端可见 | 列表/详情隔离正确 |
| R14 | 备份命令 | `sh deploy/backup.sh`（主机） | 生成 `backups/tokenhub-*.sql.gz` |
| R15 | 排障页可用 | 打开 runbook-troubleshoot | 值班能按 60 秒分流操作 |

### 2.5 自动化（层 B）

| # | 检查项 | 命令 | 通过标准 |
|---|--------|------|----------|
| R16 | 默认单测 | `npm test --workspace=@tokenhub/server` | 全部 pass |
| R17 | Web 构建 | `npm run build --workspace=@tokenhub/web` | 成功 |
| R18 | （可选）绑定隔离 | `npm run test:v001:binding --workspace=@tokenhub/server` | 需测试库；有环境时跑 |

```sh
# R16 推荐在仓库根（单测不依赖真实 DB 时，部分文件需占位 env；已与 relay-core 对齐）
cd /path/to/KodaX-Fabric
npm test --workspace=@tokenhub/server
npm run build --workspace=@tokenhub/web
```

---

## 3. 实跑记录

### Run 2026-08-11（Ticket #5 交付时）

| 字段 | 值 |
|------|-----|
| 日期 | 2026-08-11（UTC+8）；R8/R9 人工补测同周期由执行人确认 |
| 执行人 | 张闯（R8/R9 双端人工）；自动化部分见 FEATURE_001 #5 implement |
| 环境 | 生产 `tokenhub.haizhi.com` 健康检查 + 双客户端真人路径 + 本地仓库自动化 |
| 代码基线 | `dev` 分支（含 #1–#5 文档/UI 与 channel-overview 单测 env 修复） |

| # | 结果 | 备注 |
|---|------|------|
| R1 | **通过** | `curl https://tokenhub.haizhi.com/health` → `ok:true`, postgres/redis true |
| R2 | 未在本机浏览器逐项截图 | 依赖 R1 与既有公测使用；扩大签字前建议人工点一次 |
| R3 | 未登录生产主机 | 需运维在主机执行 |
| R4–R7 | 未在本 run 重做 UI 登录 | 既有同事使用中；签字前建议抽检 R4/R6/R7 |
| R8 | **通过** | 张闯：Claude Code + `anthropic_messages` Key 真实调用通过；「我的调用」可查 |
| R9 | **通过** | 张闯：Cursor + `openai_chat` Key 真实调用通过；审计可查 |
| R10–R11 | 自动化覆盖部分 | 见 R16 relay-binding / protocol 单测；人工交叉仍建议 |
| R12–R15 | 文档与能力已交付 | 配额评审值、对接人、备份演练见运营开放项 |
| R14 | 未在生产主机跑 backup | 见 runbook-release §8 |
| **R16** | **通过** | `npm test --workspace=@tokenhub/server`：修复 `channel-overview.test.ts` 缺省 env 后 **94 pass / 0 fail**（见下） |
| **R17** | **通过** | 此前 #3 已 `web` build 成功；本 run 再跑确认 |
| R18 | 未跑 | 需集成库 |

**R16 明细（2026-08-11）**

- 初始：`channel-overview.test.ts` 在无 env 时加载 `db/client`→config 失败（1 fail / 86 pass）。  
- 修复：与 `relay-core.test.ts` 相同，为测试文件设置占位 `DATABASE_URL` 等（仅单测，不连真实库）。  
- 复跑：默认 `npm test` 脚本列表 **全部通过**。

**本 run 结论**

| 判定 | 说明 |
|------|------|
| 自动化层 B | **可通过**（R16/R17） |
| 生产核心路径人工 | **可通过**（R1 + R8 + R9 均通过） |
| E10 核心路径 | **执行人+负责人已确认**（张闯）；E2/E5/E7 运营项已补齐 |

#### 放行签字（扩大公司内公测）

| 角色 | 姓名 | 日期 | 签字（可电子） |
|------|------|------|----------------|
| 执行人 | 张闯 | 2026-08-11 | 已确认（R8/R9 双端通过） |
| 负责人 | 张闯 | 2026-08-11 | 已确认（执行人兼负责人；R1/R8/R9/R16 通过） |

放行说明：R1、R8、R9、R16 已通过；E2 演练、E5 配额（5 亿/人/日）、E7 对接人（张闯 / 18612243416）已由负责人确认写入章程与 runbook。已知体验问题：日配额触顶时客户端易显示 Retry 而非明确「额度用尽」——见 [KNOWN_ISSUES 001](KNOWN_ISSUES.md)，后续优化。

---

## 4. 下次回归如何用

1. 复制 §3 增加 `### Run YYYY-MM-DD`  
2. 按 §2 全表勾选  
3. 失败项开 Ticket #6 P0 或记入已知问题，**不得**静默放行  

---

## 5. 修订

| 日期 | 说明 |
|------|------|
| 2026-08-11 | FEATURE_001 Ticket #5：清单首版 + Run 记录（自动化通过，人工双客户端待补） |
