# 评审修复计划（针对 2026-09-21 的 6 个提交）

> 来源：三份评审（内部评审 + 外部评审 A/B）交叉核实后的统一结论。
> 所有条目均已对照代码验证；已反驳与待验证的结论见文末附录，不要重复排查。
> 范围：`0ee81ac`、`7360ac0`、`fa543d5`、`e8cd840`、`e9125eb`、`0e72d02`。
>
> **状态标记约定**：某条修复完成并通过验收后，在标题末尾追加「【已修复完成】」（例：`### P1-1 敏感词热路径三合一（性能 + 绕过）【已修复完成】`）。条目原文保留作验收记录，不删除；列表型条目（P2-xx）在条目开头追加同样的标记。

---

## P0 — 部署阻断，发版前必须修复

### P0-1 Docker 镜像缺内置词库，容器起不来【已修复完成】

> **修复说明（2026-09-22，提交 `7b2ca22`）**：实际采用比方案 2 更彻底的做法——整体移除内置词库（词表由管理员自行添加或导入），而非把词库拷进镜像。migrate/seed 的自动导入、路由的 `source:"bundled"` 分支、导入库的 `readFileSync`/`LEXICON_DIR` 全部删除。原两个关注点（Docker migrate 崩溃、管理员删词被迁移复活）随之消失，Dockerfile 无需改动。
> **验证**：全局 grep 无任何残留引用；前端无内置词库入口；`sensitive-words.test.ts` 14/14 通过；tsc 构建通过且 dist 产物零词库引用。

- **现象**：`deploy/Dockerfile` 的 CMD 先跑 `node server/dist/db/migrate.js`；`server/src/db/migrate.ts:107-110` 无条件调用 `mergeBundledSensitiveWords()` 且无 try/catch；词库按 `import.meta.url` 定位到 `dist/data/sensitive-lexicon`，但 tsc 不拷 `.txt`（Dockerfile 只拷了 `server/data`，那是 haizhi-org.json 所在的另一个目录）。migrate 抛 ENOENT → `&&` 短路 → 容器 crashloop。
- **修复**（二选一）：
  1. Dockerfile 增加 `COPY --from=build /app/server/src/data ./server/dist/data`（与 knowledge.md 的拷法一致，改动最小）；
  2. 把词库内嵌为 TS 常量（更稳，免维护资产拷贝，但改动大）。
  - 推荐先上方案 1 止血，方案 2 另行排期。
- **验收**：`docker build` 后本地起容器，`docker logs` 出现 `Migrations complete`，`/health` 通过。
- **关联修复（同一次提交处理）**：`migrate.ts` 目前每次迁移都重新导入内置词库，管理员删掉的词会在下次发版被静默加回。改为仅当 `sensitive_words` 配置项不存在时导入一次。

---

## P1 — 上线前必须

### P1-1 敏感词热路径三合一（性能 + 绕过）【已修复完成】

> **修复说明（2026-09-22）**：三个子项全部落地于 `server/src/lib/relay/sensitive-words.ts`——
> 1. **预计算**：`buildCacheEntry` 在缓存构建时同步生成 `buildSensitiveWordMatcher()`（归一化词表 + Aho-Corasick 自动机），整体构建整体替换，热路径零转换；
> 2. **超长截断**：`truncateForScan` 对超 10 万字符的字符串保留首尾各 5 万字符（中段盲区是有界 CPU 的既知取舍，测试锁定）；
> 3. **总量上限**：`joinScanParts` 限制整个请求扫描文本 ≤ 25.6 万字符（首尾窗口），窗口间省略号分隔防粘接误报。
> **超出原计划的增补**：基准实测逐词 `includes` 在 1 万词 × 256K 文本下需 0.7–1.3 秒，达不到本条验收的「毫秒级」，故将匹配算法换为 Aho-Corasick（单趟线性，成本与词数无关）。
> **基准数据（Apple Silicon / Node 24）**：构建 1 万词匹配器 30ms（仅缓存刷新时）；匹配 256K 文本 **8–9ms**（1k 词与 10k 词、干净与对抗文本一致）；`collectRequestText` 走截断路径 0.1ms。
> **行为变化**：多词同时命中时 `matchedWord` 取「文本中最早出现」的词（原为词表顺序第一个），记录语义更合理。
> **验证**：`sensitive-words.test.ts` 19/19（新增 5 个：截断头/尾命中、中段盲区、总量窗口、编译归一、匹配器语义）；全量服务端套件 516/516；tsc 构建通过。

三个问题在同一处代码，一起修：

1. **每请求重算词表 normalize**：`server/src/lib/relay/sensitive-words.ts:238` 每次请求对全词表做 NFC 归一 + 正则 + 去重（默认内置词库约 1080 词，上限 1 万）。改为在 5 秒配置缓存里同时缓存 normalize 后的 needle 数组。
2. **>100K 字符字符串整体跳过 = 确定性绕过**：`sensitive-words.ts:425` 超长字符串直接不进扫描文本，把敏感词放进超长 content 字段即可同时绕过检测和拦截。改为截断扫描（取前 N + 后 N 拼接）。
3. **拼接后扫描文本无总量上限**：`collectStrings` 只限单字符串长度，bodyLimit 20–32MB，最坏情况词表 × 全文的 `includes` 扫描是秒级 CPU。给 haystack 设总量上限（如 256KB，截断保留首尾）。
- **修复参考（上游已验证）**：claude-code-hub（github.com/ding113/claude-code-hub）的 `src/lib/sensitive-word-detector.ts` 把词表全部转换成本（小写化、分桶、正则预编译）放在缓存 reload 时一次付清，`detect()` 热路径只做一次 `toLowerCase`；且 reload 先构建完整快照再原子替换引用，不暴露半套规则。我们的 NFC/零宽/去空白 normalize 照此移到缓存构建时做，生产环境已验证该路径可行。
- **验收**：新增测试覆盖「超长字符串中的敏感词仍被检出」「总量超限的请求只扫首尾」；基准：1 万词 + 1MB 文本的扫描耗时应为毫秒级。

### P1-2 批量席位功能回归【已修复完成】

> **修复说明（2026-09-22）**：决策为**正式下线**。删除 `POST /api/admin/channel-seats/bulk` 与 `POST /api/admin/channel-seats/bulk-keys` 两个接口及其专属辅助代码（`planBulkChannelSeats` / `planBulkSeatKeys` / `SEAT_BULK_MAX` / `SEAT_KEY_*` 消息与类型，lib 386→183 行）；删除 `web/src/lib/bulk-seat-keys.ts` 及其测试并从 `server/package.json` 测试清单移除；CONTEXT.md 三处批量描述同步更新；CHANGELOG 增补 Removed 条目。**保留**：`/api/admin/credentials/bulk-*`（上游渠道 KEY 批量导入是另一个在用功能）、`ops-audit-dictionary.ts` 中 `channel_seat.bulk_*` 标签（渲染历史审计记录）。
> **验证**：`channel-seats.test.ts` 9/9（删除 2 个 bulk 单测、401 注入，路由存在性断言反转为 `doesNotMatch` 下线断言）；全量服务端套件 511/511；tsc 通过；`vite build`（镜像构建路径）通过。
> **新发现的存量问题**：验证 web 构建时发现 `npm run build`（vue-tsc）在 HEAD 上即报 3 处 implicit any 错误（ErrorLogsView.vue:266 / LogsView.vue:510 / SensitiveHitsView.vue:238，均为昨日视图重写引入），已登记为 P2-16；Docker 用 `build:image`（纯 vite）不受影响。

- **现象**：SeatsView 删除后，`POST /api/admin/channel-seats/bulk`（`server/src/routes/admin/channel-seats.ts:235`）和 `/bulk-keys`（`:381`）在 web 端零调用方；`web/src/lib/bulk-seat-keys.ts` 只剩测试引用。CHANGELOG/CONTEXT 仍宣传批量能力。
- **决策**（二选一，需产品确认）：在 TempChannelsView 补回「批量登记席位 / 批量挂 KEY」入口；或明确下线，删除两个后端接口和 `bulk-seat-keys.ts`。
- **验收**：入口可用（或接口与死代码删净），CHANGELOG 同步更新。

### P1-3 用户分析排名改读预聚合表【已修复完成】

> **修复说明（2026-09-22）**：`buildUserAnalyticsRankQuery(day)` 改读 `usage_counters_daily`（唯一索引 `day + employee_id`，一次索引扫描），旧查询对 `request_audits` 的当天全量 GROUP BY、`HAVING totalTokens > 0`、排序与 Top-50 语义全部保留（`WHERE total_tokens > 0`、`ORDER BY total_tokens DESC, request_count DESC, id`）。
> **本地验证（127.0.0.1 开发库，注意是小规模开发数据）**：开发库存在「有审计、无计数」的历史日期（计数维护代码上线前写入的审计行），据此在 `migrate.ts` 增加了幂等回填（按 `QUOTA_TIMEZONE` 从 `request_audits` 全量重算并 `ON CONFLICT DO UPDATE`）；本地回填后新旧查询逐员工等价。
> **生产预检与数据清理（10.10.0.144，2026-09-22，经用户确认）**：审计表 353,798 行，重叠区间 887 个「天×员工」聚合对六字段零差异；本地发现的「有审计无计数」缺口生产不存在（回填为等值重写的空操作）。生产存在反向残留——8-28～8-31 的计数行（建库时导入的历史聚合，含上亿 token）与 8-31 晚 23:02～23:38 的 45 行试跑审计。按用户口径「数据从 9 月 1 日开始记录」，已删除 9 月前数据（先备份至本地 `/tmp/kodax-144-pre-sep-backup/`）：usage_counters_daily 31 行、usage_counters_team_daily 30 行、request_audits 45 行、request_error_logs 44 行；四表现在均从 9-01 开始。删除后重跑等价性：**22 天、889 对、diff = 0**，新旧查询在生产完全等价、零行为变化。ops_audit_logs（4,209 行，最早 8-27）为管理员操作留痕，未纳入本次清理。
> **验证**：`user-analytics.test.ts` 9/9（排名 SQL 形状断言更新 + 新增回填存在性断言）；全量套件 0 fail；tsc 通过。

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
- **P2-5 `day=9999-12-31` 返回 500**【已修复完成】：`user-analytics.ts:39-43` → `zonedDateRange` 抛错未捕获。校验 day 不得晚于今天。**修复（2026-09-22）**：GET 处理器增加 `day > today` 早退返回 400「日期不能晚于今天」（ISO 字符串比较），附源码断言测试。
- **P2-6 hits 列表用 `.parse()` 而非 `.safeParse()`**【已修复完成】：`server/src/routes/admin/sensitive-words.ts:204`，缺 `action` 参数得 500 而非 400；`logs.ts` 既有同类一并改。**修复（2026-09-22）**：实际全仓排查发现 **7 处**同类（credentials / logs / model-routes / teams / ops-audit / sensitive-words hits / users），全部改为 safeParse + 400「参数无效」守卫，其中 5 个处理器补了缺失的 `reply` 参数。

### 性能

- **P2-7 `team_members` 缺 `employee_id` 前导索引**：部门名相关子查询（`user-analytics.ts:45-54`）逐行扫描，`0042` 还删过单列索引，属系统性缺口。补 `(employee_id, team_id)` 索引。
- **P2-8 `listSensitiveWords` 每次分页全表 GROUP BY**：`sensitive-words.ts:336-342` 对只增不减的流水表聚合，量大后变慢。加短 TTL 缓存或改物化计数。

### 语义 / 误报

- **P2-9 跨字符串粘接误报**：`normalizeSensitiveNeedle` 删全部空白 + `collectRequestText` 用 `\n` 拼接，相邻字段值可能粘成敏感词（现有「不粘接」测试只是被 role/type 字符串隔开的巧合）。开了拦截会挡正常请求。修复方向（参考上游 `src/lib/message-extractor.ts`）：按字符串分段提取、分段独立匹配，不拼接。「空格插空规避」发生在单段文本内部，分段不影响该测试的兼容性。
- **P2-10 base64 图片数据进扫描文本**：英文短词会在 base64 里随机出现造成误报。当前内置词库无 ≤3 字符 ASCII 词暂时安全，自定义导入英文短词后暴露。修复方向（参考上游）：提取时只取 block 的 `text`/`content` 字段，`image_url` 等其他字段天然不进扫描，顺带省掉扫 tools/metadata 的开销。**口径警告**：上游只扫 `role='user'` + system，直接照抄会打开「敏感词藏进 assistant 历史」的绕过口（多轮对话诱导模型复述后下轮携带）；建议扫描范围保留 user + system + 最后一轮 assistant，或明确记录所接受的口径。
- **P2-11 `weeklyCreditLimit = 0` 恒判 weekly**【已修复完成】：`web/src/lib/keys-board-cooling.ts:47-53` 补 `limit > 0` 条件，并补该分支与中文排除项的测试。**修复（2026-09-22）**：守卫已加；新增 3 组测试（limit=0 落 5h / limit=100 达 95% 判 weekly / 未达判 5h；bare 错误码路径；使用上限·余额不足·套餐到期/失效排除 + null/空串）。

### 文档 / 清理

- **P2-12 CHANGELOG Unreleased 旧条与现状矛盾**【已修复完成】：第 58-59 行仍写「三级联动筛选」「报错日志按 Request ID/企业/部门筛选」，实际已改为按人搜索。更新条目。**修复（2026-09-22）**：修正 4 条矛盾条目——调用日志/报错日志两条改为「按员工搜索（远程搜人）」现状；另发现并修正 P1-2 遗留的两条已下线批量席位描述（「批量挂 KEY」「批量添加按姓名+手机号」），Unreleased 现与代码一致。
- **P2-13 死代码清理**【已修复完成】：`findSensitiveHit`、`invalidateSensitiveWordsCache`（均无调用方）；`ModelRoutesView.vue`/`ProvidersView.vue`（路由已 redirect）；`setSensitiveWordsEnabled` + `PATCH /api/admin/sensitive-words {enabled}`（`enabled` 实为 interceptEnabled，误用即全站拦截，前端已走 settings 接口，直接删）。**修复（2026-09-22）**：四块全部删除，全仓 grep 零残留，web 完整构建（vue-tsc + vite）通过证明视图无引用。备注：`/api/admin/model-routes` 后端接口仍在（不在本条范围），若确认下线可另行清理。
- **P2-14 `sensitive_word_hits.employee_id` 外键 ON DELETE no action**：删除有命中记录的员工会被阻塞。需产品决策：cascade、删人前归档、或限制删人。
- **P2-15 姓名筛选只滤 Top-50**：榜外员工搜不到。服务端加关键字参数，或复用 `/api/admin/users?q=` 远程选人。
- **P2-16 web `npm run build`（vue-tsc）在 dev 上已损坏**【已修复完成】：ErrorLogsView.vue:266 / LogsView.vue:510 / SensitiveHitsView.vue:238 三处 `rows.some((row) => …)` 的 `row` implicit any（2026-09-21 视图重写引入，2026-09-22 验证 P1-2 时发现）。镜像构建走 `build:image`（纯 vite）不受影响，但本地 `npm run build` 失败且类型检查失效。**修复（2026-09-22）**：三处 `const rows` 显式标注 `EmployeeOption[]`（与映射形状一致，源头类型化）。验证：`npm run build`（vue-tsc -b && vite build）完整通过，全量服务端套件无回归。

---

## P3 — 观察项 / 加固（不阻塞）

- `loadSensitiveWordsConfig` 抛错会 500 在配额之前（DB 挂了 relay 本来也不可用）；可用 stale-cache 兜底。
- 命中记录目前同步 await INSERT（`recordSensitiveWordHit`），可改 fire-and-forget（上游 `sensitive-word-guard.ts` 用 `void logBlockedRequest()` 模式，可直接照搬）。
- 抗规避增强：上游的 regex 匹配类型（如 `b[a@4]d`）是对付「英-雄」式标点混淆的正规出路，比继续加归一化规则干净，将来需要时优先加这类词。
- 多实例部署下词表/开关变更最多 5 秒延迟生效（缓存 TTL），可接受；若上多实例，参考上游本地事件 + Redis pub/sub 双通道失效（我们已有 ioredis 依赖）。
- `xlsx@0.18.5` 有已知 CVE（仅解析 admin 上传文件，风险低），漏洞扫描会持续报警；`@types/pdf-parse` 是 v1 类型实际用 v2。
- `users?q=` 的 `%`/`_` 未转义（ilike 通配符，非注入）。
- 检测只扫请求体不扫响应流，拦截文案却写「输入或生成内容」——文档里明确当前范围。

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
