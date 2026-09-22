# 评审修复计划（针对 2026-09-21 的 6 个提交）

> 来源：三份评审（内部评审 + 外部评审 A/B）交叉核实后的统一结论。
> 所有条目均已对照代码验证；已反驳与待验证的结论见文末附录，不要重复排查。
> 范围：`0ee81ac`、`7360ac0`、`fa543d5`、`e8cd840`、`e9125eb`、`0e72d02`。

---

## P0 — 部署阻断，发版前必须修复

### P0-1 Docker 镜像缺内置词库，容器起不来

- **现象**：`deploy/Dockerfile` 的 CMD 先跑 `node server/dist/db/migrate.js`；`server/src/db/migrate.ts:107-110` 无条件调用 `mergeBundledSensitiveWords()` 且无 try/catch；词库按 `import.meta.url` 定位到 `dist/data/sensitive-lexicon`，但 tsc 不拷 `.txt`（Dockerfile 只拷了 `server/data`，那是 haizhi-org.json 所在的另一个目录）。migrate 抛 ENOENT → `&&` 短路 → 容器 crashloop。
- **修复**（二选一）：
  1. Dockerfile 增加 `COPY --from=build /app/server/src/data ./server/dist/data`（与 knowledge.md 的拷法一致，改动最小）；
  2. 把词库内嵌为 TS 常量（更稳，免维护资产拷贝，但改动大）。
  - 推荐先上方案 1 止血，方案 2 另行排期。
- **验收**：`docker build` 后本地起容器，`docker logs` 出现 `Migrations complete`，`/health` 通过。
- **关联修复（同一次提交处理）**：`migrate.ts` 目前每次迁移都重新导入内置词库，管理员删掉的词会在下次发版被静默加回。改为仅当 `sensitive_words` 配置项不存在时导入一次。

---

## P1 — 上线前必须

### P1-1 敏感词热路径三合一（性能 + 绕过）

三个问题在同一处代码，一起修：

1. **每请求重算词表 normalize**：`server/src/lib/relay/sensitive-words.ts:238` 每次请求对全词表做 NFC 归一 + 正则 + 去重（默认内置词库约 1080 词，上限 1 万）。改为在 5 秒配置缓存里同时缓存 normalize 后的 needle 数组。
2. **>100K 字符字符串整体跳过 = 确定性绕过**：`sensitive-words.ts:425` 超长字符串直接不进扫描文本，把敏感词放进超长 content 字段即可同时绕过检测和拦截。改为截断扫描（取前 N + 后 N 拼接）。
3. **拼接后扫描文本无总量上限**：`collectStrings` 只限单字符串长度，bodyLimit 20–32MB，最坏情况词表 × 全文的 `includes` 扫描是秒级 CPU。给 haystack 设总量上限（如 256KB，截断保留首尾）。
- **验收**：新增测试覆盖「超长字符串中的敏感词仍被检出」「总量超限的请求只扫首尾」；基准：1 万词 + 1MB 文本的扫描耗时应为毫秒级。

### P1-2 批量席位功能回归

- **现象**：SeatsView 删除后，`POST /api/admin/channel-seats/bulk`（`server/src/routes/admin/channel-seats.ts:235`）和 `/bulk-keys`（`:381`）在 web 端零调用方；`web/src/lib/bulk-seat-keys.ts` 只剩测试引用。CHANGELOG/CONTEXT 仍宣传批量能力。
- **决策**（二选一，需产品确认）：在 TempChannelsView 补回「批量登记席位 / 批量挂 KEY」入口；或明确下线，删除两个后端接口和 `bulk-seat-keys.ts`。
- **验收**：入口可用（或接口与死代码删净），CHANGELOG 同步更新。

### P1-3 用户分析排名改读预聚合表

- **现象**：`server/src/routes/admin/user-analytics.ts:56-92` 每次加载/切日期对 `request_audits` 做全天全量 GROUP BY；而 `writeRelayAudit` 已维护口径一致的 `usage_counters_daily`（唯一索引 `day + employee_id`，见 `server/src/lib/relay/audit.ts:187-204`）。
- **修复**：排名查询改读 `usage_counters_daily`，一次索引扫描替代全天重聚合。
- **验收**：同一天数据下新旧查询结果一致（可灰度对比），页面加载不再触发大表聚合。

---

## P2 — 近期排期

### 可靠性 / 正确性

- **P2-1 积分展示口径 ≠ 结算口径**：`server/src/routes/admin/logs.ts:55-64`、`user-analytics.ts:307-330` 用 `createdAt` 当起止时刻重算折扣，而结算（`audit.ts:124-133`）按 `[startedAt, now]` 跨峰加权且只计成功行。修复：`request_audits` 落 `request_credits`（及 `started_at`），展示端直读；短期先在 UI 注明「按结束时刻估算」。
- **P2-2 当日明细 5000 条静默截断**：`user-analytics.ts:252-262` 无 ORDER BY 无截断标记，大概率取最早 5000 条、恰好截掉 14–18 点高峰，且与全量 KPI 并排对不上账。加排序 + 截断标记（前端提示估算值）。
- **P2-3 coolUntil 测试路径覆盖 relay 语义**：`credentials.ts:576-580` 管理员「测试」成功时 `coolUntil: null` 会清掉 relay 刚写的冷却，失败时直接缩短；relay 侧 `upstream.ts:460` 用 `greatest()` 只延长。对齐：测试路径不清不缩 relay 写入的冷却。
- **P2-4 前端请求竞态**：`UserAnalyticsView.vue` 的 `load()` 无请求序号保护（旧响应回滚新状态，该接口一次跑 7 个聚合 SQL）；`SettingsView.vue` PATCH 期间开关未禁用，乱序响应致 UI 与后端相反。统一加「只认最后一次请求」守卫 / patching 状态。
- **P2-5 `day=9999-12-31` 返回 500**：`user-analytics.ts:39-43` → `zonedDateRange` 抛错未捕获。校验 day 不得晚于今天。
- **P2-6 hits 列表用 `.parse()` 而非 `.safeParse()`**：`server/src/routes/admin/sensitive-words.ts:204`，缺 `action` 参数得 500 而非 400；`logs.ts` 既有同类一并改。

### 性能

- **P2-7 `team_members` 缺 `employee_id` 前导索引**：部门名相关子查询（`user-analytics.ts:45-54`）逐行扫描，`0042` 还删过单列索引，属系统性缺口。补 `(employee_id, team_id)` 索引。
- **P2-8 `listSensitiveWords` 每次分页全表 GROUP BY**：`sensitive-words.ts:336-342` 对只增不减的流水表聚合，量大后变慢。加短 TTL 缓存或改物化计数。

### 语义 / 误报

- **P2-9 跨字符串粘接误报**：`normalizeSensitiveNeedle` 删全部空白 + `collectRequestText` 用 `\n` 拼接，相邻字段值可能粘成敏感词（现有「不粘接」测试只是被 role/type 字符串隔开的巧合）。开了拦截会挡正常请求。修复方向：按字符串分段匹配而非拼接后匹配（注意与「空格插空规避」测试的兼容）。
- **P2-10 base64 图片数据进扫描文本**：英文短词会在 base64 里随机出现造成误报。当前内置词库无 ≤3 字符 ASCII 词暂时安全，自定义导入英文短词后暴露。跳过 `data:` URL 前缀的长字符串或降权。
- **P2-11 `weeklyCreditLimit = 0` 恒判 weekly**：`web/src/lib/keys-board-cooling.ts:47-53` 补 `limit > 0` 条件，并补该分支与中文排除项的测试。

### 文档 / 清理

- **P2-12 CHANGELOG Unreleased 旧条与现状矛盾**：第 58-59 行仍写「三级联动筛选」「报错日志按 Request ID/企业/部门筛选」，实际已改为按人搜索。更新条目。
- **P2-13 死代码清理**：`findSensitiveHit`、`invalidateSensitiveWordsCache`（均无调用方）；`ModelRoutesView.vue`/`ProvidersView.vue`（路由已 redirect）；`setSensitiveWordsEnabled` + `PATCH /api/admin/sensitive-words {enabled}`（`enabled` 实为 interceptEnabled，误用即全站拦截，前端已走 settings 接口，直接删）。
- **P2-14 `sensitive_word_hits.employee_id` 外键 ON DELETE no action**：删除有命中记录的员工会被阻塞。需产品决策：cascade、删人前归档、或限制删人。
- **P2-15 姓名筛选只滤 Top-50**：榜外员工搜不到。服务端加关键字参数，或复用 `/api/admin/users?q=` 远程选人。

---

## P3 — 观察项 / 加固（不阻塞）

- `loadSensitiveWordsConfig` 抛错会 500 在配额之前（DB 挂了 relay 本来也不可用）；可用 stale-cache 兜底。
- 命中记录目前同步 await INSERT（`recordSensitiveWordHit`），可改 fire-and-forget。
- `xlsx@0.18.5` 有已知 CVE（仅解析 admin 上传文件，风险低），漏洞扫描会持续报警；`@types/pdf-parse` 是 v1 类型实际用 v2。
- `users?q=` 的 `%`/`_` 未转义（ilike 通配符，非注入）。
- 检测只扫请求体不扫响应流，拦截文案却写「输入或生成内容」——文档里明确当前范围。
- 多实例部署下词表/开关变更最多 5 秒延迟生效（缓存 TTL），可接受，知晓即可。

---

## 附录：已反驳 / 待验证（不要重复排查）

| 结论 | 处置 |
| --- | --- |
| A：「脏配置 `{detect:false, intercept:true}` 读取时重开检测是 bug」 | **反驳**。`resolveSensitiveWordFlags` 的强制收敛是故意设计，`sensitive-words.test.ts:150-153` 明确锁定该行为；应用层写入路径全部归一化，仅手工改 DB 可达，且收敛方向是「更严」的 fail-safe。不改。 |
| B：「`LogsView.vue` `limit=5` 疑似调试残留」 | **反驳**。来自更早提交 `dac4461`「管理端调用日志改为每页 5 条」，有意为之。不改。 |
| B：「限流车道近乎失效（lastError 存上游原文后 `isShortRateLimitCooling` 匹配不上）」 | **待验证**。逻辑上可能，需拿一条真实无码 429 的原文实测再定。 |

---

## 建议执行顺序

1. P0-1（一行 COPY 止血 + migrate 仅首次导入）
2. P1-1 热路径三合一 → P1-3 排名读预聚合 → P1-2 批量席位（需产品决策，可并行确认）
3. P2 按模块分组提交：可靠性一组（P2-1~6）、性能一组（P2-7~8）、语义一组（P2-9~11）、文档清理一组（P2-12~15）
