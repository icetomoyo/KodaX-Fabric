# Token Hub 故障怎么查（值班一页纸 · E6 / E7）

| 项 | 内容 |
|----|------|
| 读者 | 管理员 / 值班（不是员工日常接入） |
| 门槛 | **E6** 故障可感知 · **E7** 问题入口（操作侧） |
| 生产 | `https://tokenhub.haizhi.com` |
| 关联 | [公测章程](pilot-charter.md) · [发布/备份](runbook-release.md) · 员工接入教程见网页 `/me/guide` |

> **目标**：接到报障后，按固定顺序 5 分钟内判断「全站 / 单人 / 上游 / 配额 / 配置」，并知道下一步动作。  
> 员工侧自助排障仍以 **`/me/guide` → 常见问题** 为准；本文不替代发布回滚（见 runbook-release）。

---

## 0. 60 秒分流

| 现象 | 先看 | 更像 |
|------|------|------|
| 所有人打不开站点 / 全员 5xx | §1 健康检查 + 容器 | **全站 / 依赖** |
| 仅某人 IDE 失败 | §2 调用日志 + Key/协议 | **单人配置** |
| 多人同一模型/渠道失败 | §2 日志 + 管理端渠道 | **上游 / 凭证** |
| 上午还能用下午突然拒 | §3 配额 / 限流 | **日 Token 或 safeguard** |
| 有人提交了工单 | §4 工单 | **跟进入口** |

---

## 1. 健康检查（E6 最低探测）

### 1.1 公网

```sh
curl -fsS https://tokenhub.haizhi.com/health
```

期望 HTTP **200**，JSON 大致为：

```json
{
  "ok": true,
  "service": "kodax-fabric-api",
  "postgres": true,
  "redis": true,
  "time": "..."
}
```

| 结果 | 含义 | 动作 |
|------|------|------|
| `ok: true` | API + Postgres + Redis 可达 | 全站未死，往下查单请求 |
| HTTP **503** 或 `ok: false` | 依赖失败 | 看 `postgres` / `redis` 哪项为 false |
| 连不上 / 证书错误 | 入口或 TLS | 查 Caddy/web、`/etc/tokenhub/tls`、DNS；见 [runbook-release](runbook-release.md) §6 |
| 浏览器能开站但 health 失败 | 反代或 api 挂 | `docker compose -f deploy/compose.yaml ps` / `logs api` |

### 1.2 主机上（可选）

```sh
cd /path/to/KodaX-Fabric/deploy
docker compose ps
docker compose logs --tail=80 api
docker compose logs --tail=40 postgres redis web
```

- `api` 不健康：看迁移/环境变量；必要时按发布 runbook **回滚镜像**  
- 仅 `web` 异常：证书与 Caddyfile  
- DB/Redis 不健康：**勿删 volume**，先日志与磁盘  

---

## 2. 调用日志怎么查（定位单请求）

### 2.1 员工

路径：**员工端 → 我的调用**（`/me/logs`）

- 看终态、HTTP 状态、错误码、模型、时间  
- 可打开自己的请求/响应正文（脱敏后）  
- 报障时让员工提供：**时间点 + 模型名 + 错误原文**（**不要**贴完整 `th_` Key）

### 2.2 管理员

路径：**管理端 → 调用日志**（`/admin` 日志）

- 按员工、时间、模型、状态筛选  
- 详情含结构化上下文（正文仅管理员可读，读取会记操作审计）  
- 对照是否同一 `productLine` / 上游凭证末四位集中失败  

### 2.3 概览

**管理端 → 概览**：当日失败数、渠道异常、最近错误 — 判断是否「刚开始大面积挂」。

---

## 3. 常见错误 → 动作

> 客户端错误 envelope 可能是 OpenAI 或 Anthropic 形态；以 **HTTP 状态 + error code** 为准。

### 3.1 鉴权 / 账号

| 信号 | 常见原因 | 值班动作 |
|------|----------|----------|
| **401** `invalid_api_key` | Key 粘贴不全、已删、员工停用、角色已非 employee | 让员工重建 Key；核对账号是否 active；协议/鉴权头是否对（Anthropic vs Bearer） |
| 能登录网页但不能调模型 | 未改密、Key 绑定渠道已停 | 强制改密流程；查渠道与授权 |

### 3.2 渠道 / 模型 / 上游

| 信号 | 常见原因 | 值班动作 |
|------|----------|----------|
| **503** `bound_channel_unavailable` | 绑定渠道/供应商停用或运行时不可用 | 管理端上游渠道状态；勿让员工换「别的渠道同名模型」幻想跨渠道 |
| **404** `model_not_found` | 模型不在绑定渠道可调用集 | 让员工 `/ai/models` 只取返回 ID；查显式路由/发现模型 |
| **503** `model_unavailable` | 模型有配置但无可用匹配凭证 | 凭证 weight/状态/协议；grant_only 是否授权 |
| **429** `model_channels_cooling` | 凭证冷却（常伴随上游 429） | 等 `Retry-After`；查上游额度/限流；多 Key 权重 |
| 上游 401/403 后渠道异常 | 凭证被标 `auto_disabled` | 管理端凭证状态；轮换/修复上游 Key 后启用 |
| 400 不重试 | 请求体/参数问题 | 看审计正文；改客户端请求，非网关换 Key 能好 |

### 3.3 配额 / 限流（safeguard）

| 信号 | 常见原因 | 值班动作 |
|------|----------|----------|
| 日 Token 用尽（硬限拒绝） | 达员工日上限 | 管理端员工详情/配额；是否调高默认策略（章程 §5）。**注意**：部分客户端（如 Claude Code）可能把 429 显示成 `API error · Retrying`，员工不易理解为「今日额度用尽」——见 KNOWN_ISSUES 001，后续改协议内明确提示 |
| 频繁 429、非 cooling 语义 | `RELAY_SAFEGUARD_RPM` / 并发 | 查部署 env 默认；让员工降并发；非业务「多套配额」 |
| 仅高峰失败 | 上游或 safeguard | 对照概览与上游控制台 |

日界：默认 **Asia/Shanghai** 零点重置日 Token 计数（以部署 `QUOTA_TIMEZONE` 为准）。

### 3.4 客户端配置（常被当成「服务挂了」）

| 信号 | 动作 |
|------|------|
| Base URL 带 `:3100` | 改为公网 `https://tokenhub.haizhi.com`（或章程公布的 Base URL），**无**内部端口 |
| Claude Code 用了 Chat Completions Key | 重建 **Anthropic Messages** Key；见 `/me/guide` |
| Cursor 用了 Messages Key | 重建 **OpenAI Chat Completions** Key |
| CC Switch 环回 | 上游必须是 TokenHub，不能是 `127.0.0.1:15721` |

---

## 4. 问题入口（E7 操作）

| 来源 | 路径 | 值班动作 |
|------|------|----------|
| 员工工单 | 管理端 **工单** `/admin/tickets` | 按编号/姓名查；看标题与描述；**勿要求员工贴完整 Key** |
| 员工自助 | `/me/tickets` 提交 | 仅本人可见；当前无站内回复流时，站外回复后可在团队习惯下闭环 |
| 对接人 | 章程 [§8.2](pilot-charter.md#e7-support) 填写表 | 全站故障走主管理员；超时预期见章程 §8.3 |

**响应预期（与章程一致，粗粒度）**

- 全员不可用：工作时间内尽快响应（目标 4 小时内有人接）  
- 单人接入/Key：1～2 个工作日有回复  
- 策略/新渠道：评估排期  

---

## 5. 推荐排查顺序（清单）

值班收到「不能用」时按序勾：

1. [ ] `curl -fsS https://tokenhub.haizhi.com/health` → `ok: true`？  
2. [ ] 仅一人还是多人？多人 → 概览 + 渠道；一人 → 其调用日志  
3. [ ] 错误码是 401 / 404 / 429 / 503 中的哪类？对上 §3  
4. [ ] 协议与客户端是否匹配（Claude Code vs Cursor）？  
5. [ ] 日配额是否打满（员工详情 / 配额页）？  
6. [ ] 需要改基础设施？→ [runbook-release](runbook-release.md) 回滚/备份，**不要**在未备份时删库  
7. [ ] 结果与动作记一笔（工单备注或值班群），便于 E10 回归复盘  

---

## 6. 明确不做（本页边界）

- 不部署完整 APM/告警平台（E6 最低配到此为止）  
- 不扩展工单回复/指派（产品能力外）  
- 不指导跨渠道容灾或改协议互转  

---

## 7. 修订

| 日期 | 说明 |
|------|------|
| 2026-08-11 | FEATURE_001 Ticket #4 首版 |
