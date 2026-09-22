# 请求上下文落盘改动计划 v2（2026-09-22）

> 背景：144 上 Docker 卷 `tokenhub_request_context` 工作日每天新增约 10–15G（2026-09-22 测：卷 113G；当天已 11G / 3.2 万文件）。不是系统 journal，是每次模型转发把完整请求 JSON gzip 落盘。
> 产品约束：**不删除历史**。每一次请求都还要能对上、能还原当时模型看到的内容。
> 范围：`server/src/lib/relay/request-context.ts`、调用日志读路径、新增静态文件登记与管理页。Postgres 计量行（`request_audits`）口径不改。
>
> **状态标记约定**：某条落地并通过验收后，在标题末尾追加「【已修复完成】」。条目原文保留作验收记录，不删除。

---

## 问题用三句话说明

每一次调用就是三样东西：

1. **本轮用户新问的**（本次提示词，可能带新读的文件、新跑的命令）
2. **到这一轮之前的历史**（前面问过的、答过的、读过的源码 / PDF / 截图）
3. **本轮模型新答的**

模型看书时 1 和 2 一起看，只写出 3。下一轮客户端把 3 贴进历史，再连同新的 1 整包 POST 上来。

**现在 Hub 存的是这一枪的整包（1+2+3 全文）**。会话每长一截，就把整本再复印一遍。同一份 PDF 从某一轮读进来后，后面每一轮都会再印一份进新的 `threq_*.json.gz`；同理每轮重发的 `system` / `tools`（含 skills 定义，agent 类客户端普遍 30–100KB）也在每枪里重复。

144 抽样：普通偏大一次 gzip 约 350KB，解开后约 1MB JSON，几乎全是 `requestBody.messages`；带 PDF/图片的一次可到 1–8MB gzip，正文里是 `type: document|image` + `source.type: base64` 的整文件。

---

## 方案（一句话）

**信封按「用户/日期」记，大块内容按指纹全局存一份，数据库登记归属，管理页可视化。**

- 现在第 N 轮存 N 页、累计约平方增长 → 改完每轮只写新增，线性增长
- 同一份 PDF / tools / skills 定义全系统只存一份，后面全是引用
- 谁的文件、谁在吃磁盘：数据库一条 join 查出来，管理页直接看

不改的部分：

- 每次请求仍有一条 `request_audits` 计量行（人、模型、时间、用量口径不变）
- 不删已有文件、不做按天过期；旧 `<日目录>/threq_*.json.gz` 永久可读
- 全文不进 Postgres（DB 只做文件登记簿，不存内容、不存每请求引用明细）

---

## 落地形态

```
<REQUEST_CONTEXT_DIR>/
  files/<前两位>/<sha256>                           # PDF/图片：解码后的原始二进制，全局一份
  blocks/<前两位>/<sha256>.gz                       # 非二进制大块：system/tools/skills、长 tool_result、长文本
  users/<employeeId>/<quota-day>/threq_<id>.json.gz # 瘦信封，gzip JSON（每用户按日；API 输出仍是明文标准 JSON）
  <quota-day>/threq_<id>.json.gz                    # 旧布局，只读，不再写
```

**内容库（files/ + blocks/）**

- 拆块对象：requestBody / responseBody / streamAudit.assembled 下**任何超阈值子树**——`system`、`tools`（含 skills 定义）、`messages[i]`、`messages[i].content[j]`。只拆 messages 会漏掉每轮重发的 system/tools
- `type: document|image` 且 `source.type: base64` 的块：**解码后存原始二进制进 files/**，指纹 = 解码后字节的 SHA-256（省 25% base64 膨胀、管理页可直接预览、指纹即文件指纹）
- 其余超阈值 JSON 块：按现有 `sanitizeContextValue` / `redactHeaders` 打码后 gzip 进 blocks/，指纹 = 打码后 JSON 的 SHA-256
- 阈值 `REQUEST_CONTEXT_BLOB_MIN_BYTES` 默认 **1024**（按 2026-09-22 上午样本实测定，见下节；短句仍留信封）
- 消息骨架（role 等小字段）留在信封内联，信封保持自描述；gzip 后 `zcat | jq` 可读

**信封（每枪一份，变瘦）**

- 只写信封字段：人 / 模型 / 路径 / 渠道 Key 后缀 / 耗时 / 状态 / tokens / 打码 headers / retryTrace
- 超阈值字段替换为指向：`{ "blob": "<sha256>", "kind": "file"|"block", "bytes": <大小>, "media_type": "..." }`
  - `bytes`：file = 解码后字节数；block = 未压缩 JSON 字节数（供读侧零 IO 估算水合大小）
- 加 `contextFormat: 2` 与旧整包 gzip 区分
- **信封 gzip 存盘**：「直接调用」的体验由 API 保证（详情/下载输出仍是明文标准 JSON），磁盘信封 `zcat | jq` 即可；gzip 与否差 2.4 倍体积（38% → 15%），按实测取 gzip

**实测体积（2026-09-22，144 上午 12 点前样本：11,364 个请求 / 3,600 MB gzip，试算脚本 `scripts/simulate-v2-sizing.mjs`）**

| 阈值 | v2 合计（信封 gzip） | 占现在 | 信封若不 gzip | 唯一 blobs | 引用/请求 |
|---|---|---|---|---|---|
| 512B | 527 MB | 15% | 38% | 171 MB / 40,737 块 | 101 |
| 1KB | 576 MB | 16% | 45% | 165 MB / 27,413 块 | 64 |
| 8KB | 946 MB | 26% | 85% | 139 MB / 4,765 块 | 10 |

结论：去重后唯一新内容极小（约 171 MB/半天，其中 PDF/图片仅 18.5 MB / 116 个）；大头是信封的引用列表（长会话每请求 ~100 个引用）。**信封 gzip 后阈值不敏感（512B 与 1KB 仅差 9%），取 1KB 平衡指纹对象数**。全天推算约 **2.5–3G/天**（现状 10–15G，降约 5 倍）；若坚持信封明文则约 6–7G/天。指纹对象量级：约 5.5 万/天 → 全年千万级，文件系统需预留足够 inode（或用 XFS），写进部署文档。

**数据库登记（迁移新增两表）**

```
static_files        id, sha256 unique, kind(file|block), bytes, media_type, first_seen_at, first_request_id
static_file_owners  file_id, employee_id, team_id, first_seen_at   -- file+employee 唯一，归属多对多
```

- **只在新指纹首次落盘时 upsert**，命中不写库；`static_file_owners` 在「该用户首次出现该文件」时插一行
- **禁止**建每请求-文件引用明细表（400 轮会话 × 每轮几百块 = 把磁盘膨胀搬进 Postgres）
- 读路径（下载/详情/拼回）不查库，按指纹直接读盘；DB 只是登记簿，允许与盘漂移，管理页做存在性检查兜底

**管理页（第二步）**

- `web/src/views/admin/StaticFilesView.vue` + `server/src/routes/admin/static-files.ts`
- 列表：指纹缩写、类型、大小、media_type、首见时间、归属人（多对多）、按人/按大小筛选排序；PDF/图片在线预览、下载；block 展开 JSON
- 直接回答 144 的问题：「一天 10–15G 是谁干的」
- 先超管可见（调用日志详情本就能看全文，未扩大暴露面）；表带 employee/team 字段，将来可放开企业级

---

## 读路径

- 定位：`request_audits` 行取 `employee_id` + `created_at` → `users/<id>/<quota-day>/threq_<requestId>.json.gz`，邻日回退沿用；未命中再回退旧 `<root>/<quota-day>/threq_<requestId>.json.gz`
- format 2 递归把引用拼回完整 JSON（引用校验 `[a-f0-9]{64}`，路径限死在 files/blocks 两级目录内，防穿越）；旧格式整包直读，两边共存
- 详情抽屉：信封内引用的 `bytes` 求和估算水合大小——≤256KB 才读库水合，超了直接显示信封 + 引用（带 bytes/media_type，信息量不低于现在的「omitted 请下载」）
- 下载全文：拼回后输出与现在相同形状的 JSON（`requestBody` / `responseBody` / `streamAudit`），排障习惯不变；由纯流式改为内存拼装，单次峰值 ≈ 未压缩大小（≤ REQUEST_CONTEXT_MAX_BYTES），超管低频端点可接受

---

## 硬性项（评审确认，不可省）

1. `system` / `tools` / skills 定义必须在拆块范围（否则每天仍白写几个 G）
2. 指纹文件写失败 → 该块**降级内联**进信封并记日志，保住「每次请求都能拼回」
3. 并发写同一指纹：staging 临时名加随机后缀（现有 `${pid}.tmp` 同进程并发会撞）
4. 详情抽屉按 `bytes` 估算水合；下载端点改为拼回输出

---

## 实现步骤

> **进度（2026-09-22）**：第一步代码已完成并通过测试——`request-context.test.ts` 20/20、全量套件 552/552、真实样本冒烟 300/300 语义相等（`scripts/smoke-v2-roundtrip.mjs`，仅 document/image 块键序规范化为 type/source，值逐字节一致）；typecheck 通过。待部署 144 验收后再标【已修复完成】。第二步（管理页）未开工。

### 第一步（止血：写读路径 + 登记）

- `server/src/lib/relay/request-context.ts`：拆块、指纹、写信封、拼回；`serializeRequestContext` 的 MAX_BYTES 截断逻辑保留作兜底
- `server/src/config.ts` 加 `REQUEST_CONTEXT_BLOB_MIN_BYTES`（默认 1024，依据上节实测）；`deploy/compose.yaml` 补环境变量；部署文档注明指纹对象全年千万级、文件系统 inode 预留
- `server/src/routes/admin/logs.ts`：详情与下载两处 select 补 `employeeId`，新布局定位 + 旧布局回退
- schema 迁移新增 `static_files` / `static_file_owners`，落盘时首次指纹 upsert

### 第二步（管理页）

- `server/src/routes/admin/static-files.ts` + `web/src/views/admin/StaticFilesView.vue`
- 库盘对账：孤儿行 / 缺文件标记（只标记，不删）

### 测试（扩 `server/test/request-context.test.ts`）

- 同一 PDF / 同一 tools 定义写两次：内容库只有一份，两个信封各带引用；短文本不进库
- `system` / `tools` 超阈值进 blocks；阈值边界 8191 / 8192 / 8193
- 拼回后与拆前语义相等；密钥 header / `api_key` 字段仍 `[redacted]`，且不产生明文指纹
- 指纹写失败降级内联；并发写同一指纹；引用缺失时下载返回明确错误而非损坏 JSON
- base64 document 解码往返一致；旧整包 gzip 仍可读；`logs.test.ts` 下载/详情不断

### 文档

- `CHANGELOG.md` Unreleased：调用日志仍可下载当时全文，盘上改为「新内容存一份、重复共用」，新增静态文件登记
- `request-context.ts` 文件头注释改为新布局；删掉易被理解成「要做清理」的表述——本计划明确 **不做删除**

---

## 验收

- 同一份 PDF 出现在同一会话后续 N 轮：`files/` 只有一个对象，N 个信封只带引用
- 长会话磁盘近似随「新内容」线性增长，而不是随「历史长度」平方增长
- 信封落在 `users/<employeeId>/<quota-day>/`；详情抽屉能打开；「下载全文」能还原当时的 requestBody（含 PDF document 块）和本轮响应
- 部署前已有的旧 `threq_*.json.gz` 仍能下载
- `request_audits` 行数、tokens、积分口径不变
- `static_files` join `static_file_owners` 能查出每用户占用；管理页可见归属与预览
- 不引入按天删除、不把全文或每请求引用明细写进 Postgres

---

## 明确不做

- 按天 / 按容量删除请求上下文（已否决）
- 每请求-文件引用明细表（防 Postgres 膨胀）
- 只换 zstd、只去掉 `responseBody` 与 `streamAudit.assembled` 的重复（对体积几乎不动）
- 把 PDF 另存成独立 `.pdf` 文件名（内容库按指纹即可，下载时还原回 JSON 里的 document 块）
- 详情抽屉改成「只显示最后 2 轮、拼不出完整会话」（下载必须能拼回）
