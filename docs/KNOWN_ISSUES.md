# KNOWN_ISSUES

Last Updated: 2026-08-14 11:52

来源：v0.0.1→v0.1.0 累计回归（2026-08-14）。当前发布 **v0.1.0**，不建议判定生产完全落地。

## Issue Index

| ID | Title | Priority | Status | Introduced | Fixed |
|----|-------|----------|--------|------------|-------|
| 001 | IP 白名单可被伪造 X-Forwarded-For 绕过 | High | Resolved | v0.0.8 | unreleased (8ef74e0) |
| 002 | 发布镜像嵌入陈旧前端（缺 org/audit） | High | ready | v0.1.0 | — |
| 003 | 模型别名与 Provider RPM 未接入生产路径 | Medium | ready | v0.0.4 / v0.0.6 | — |
| 004 | restore 后再启 gateway 会重跑 bootstrap | High | Resolved | v0.1.0 | unreleased (cb47308) |
| 005 | Redis 挂了 /health 仍 200 | Medium | ready | v0.1.0 | — |

## Issue Details

### ISSUE_001: IP 白名单可被伪造 X-Forwarded-For 绕过

| 字段 | 内容 |
|------|------|
| Priority | **High** |
| Status | **Resolved** |
| Introduced | v0.0.8 |
| Fixed | unreleased（`8ef74e0`，在 v0.1.0 之后） |
| Created | 2026-08-14 |

**Original Problem**

- **当前**：`callerIP` 无条件取请求头 `X-Forwarded-For` 第一段。客户端伪造允许 IP 后，白名单 VK 能调通 `/v1`。
- **期望**：只信任来自反代的转发头（或默认识别 `RemoteAddr`）；伪造头不能绕过。
- **复现**：VK 配 `IPAllow`；请求带 `X-Forwarded-For: <名单内 IP>`；观察 200 而非 403。
- **位置**：`internal/hub/server.go` `callerIP`。

**Context**

008 规格写「可认第一段 X-Forwarded-For」，本意是网关在反代后面。直出 8080 时客户端可任意写该头。公开部署前必须处理。

**Proposed Solution**

默认只用 `RemoteAddr`。仅当显式配置信任代理（如 `TRUST_PROXY=1` 或 CIDR 名单）时才读 `X-Forwarded-For`。

**Resolution**

默认 `callerIP` 只用 `RemoteAddr`。`TRUST_PROXY=1`/`true`/`yes` 时才认 `X-Forwarded-For` 第一段。伪造 XFF 不再绕过白名单。

- **Resolution Date**: 2026-08-14
- **Files Changed**: `internal/hub/server.go`, `internal/hub/v008_test.go`, `cmd/gateway/main.go`, `deploy/README.md`
- **Tests Added**: `TestSpoofedForwardedForDoesNotBypassIPAllow`（未信任 403 + 0 上游；信任代理后 200）

---

### ISSUE_002: 发布镜像嵌入陈旧前端

| 字段 | 内容 |
|------|------|
| Priority | **High** |
| Status | **ready** |
| Introduced | v0.1.0（源码路由已有，embed 未跟上） |
| Created | 2026-08-14 |

**Original Problem**

- **当前**：源码 `web/src/app/router.tsx` 有 `/admin/org`、`/admin/audit`。`internal/webui/dist` 里 `admin-layout` 导航只有总览/用户/上游/池/渠/VK，没有团队项目和路由审计。`deploy/Dockerfile` 只 `COPY` 后 `go build`，不跑 `npm run build`。
- **期望**：镜像内嵌 SPA 与当前 `web/src` 一致；构建流水线在 embed 前重编前端。
- **复现**：`docker compose -p tokenhub --build` 打开 `/admin`，侧栏无「团队项目」「路由审计」。

**Context**

`//go:embed all:dist`。谁忘了在仓库里提交新 dist，发布就是旧 UI。这是发布门禁，不是产品能力缺口。

**Proposed Solution**

Dockerfile 增加 Node 阶段 `npm ci && npm run build`，把 `web/dist` 拷进 `internal/webui/dist` 再编 Go；或 CI 检查 dist 与源码同步。

---

### ISSUE_003: 模型别名与 Provider RPM 未接入生产路径

| 字段 | 内容 |
|------|------|
| Priority | **Medium** |
| Status | **ready** |
| Introduced | 别名 v0.0.4；Provider RPM v0.0.6 |
| Created | 2026-08-14 |

**Original Problem**

- **当前**：T1 可测 `Server.Aliases`、`ResolvedVK.ProviderRPM`。`cmd/gateway` 的 `hub.New` 不加载别名配置。`Postgres.ResolveVK` 不填充 `ProviderRPM`（无列可读）。生产 compose 这两项等于没接上。
- **期望**：要么生产可配置并生效，要么文档标明「仅夹具/未产品化」，避免当成已交付。
- **复现**：compose 栈无法靠配置打开模型别名；Provider 维 RPM 在 Postgres 路径恒为空，不限流。

**Context**

回归结论：部分能力只在单元测试接通。与 004/005 控制台配置债同类，但是网关热路径缺口。

---

### ISSUE_004: restore 后再启 gateway 会重跑 bootstrap

| 字段 | 内容 |
|------|------|
| Priority | **High** |
| Status | **Resolved** |
| Introduced | v0.1.0 |
| Fixed | unreleased（`cb47308`，在 v0.1.0 之后） |
| Created | 2026-08-14 |

**Original Problem**

- **当前**：`deploy/restore.sh` 在灌库后 `docker compose start gateway`。gateway `depends_on: bootstrap: service_completed_successfully`，Compose 会再拉起 bootstrap。bootstrap 对 operator / VK 是 `ON CONFLICT DO UPDATE`，会改写刚还原的初始化状态。
- **期望**：还原后只启动 gateway，不重跑 bootstrap，dump 里的数据保持原样。
- **复现**：改一条编目 → `./backup.sh` → 再改 → `./restore.sh` → 观察 bootstrap 容器再次 Started，种子数据被写回。

**Context**

009 收口的备份路径。脚本本身没有调 bootstrap，是 Compose 依赖边导致的。

**Proposed Solution**

`start --no-deps gateway`（或等价），并在文档写明禁止用 `up` 代替 `start` 做还原后拉起。

**Resolution**

`restore.sh` 与失败 cleanup 都改为 `start --no-deps gateway`。文档写明不要用 `compose up` 收尾还原。

- **Resolution Date**: 2026-08-14
- **Files Changed**: `deploy/restore.sh`, `deploy/compose_test.go`, `deploy/README.md`
- **Tests Added**: `TestRestoreStartsGatewayWithoutDeps`

---

### ISSUE_005: Redis 挂了 /health 仍 200

| 字段 | 内容 |
|------|------|
| Priority | **Medium** |
| Status | **ready** |
| Introduced | v0.1.0（health 覆盖层） |
| Created | 2026-08-14 |

**Original Problem**

- **当前**：`GET /health` 的 HTTP 状态只看 Postgres。`REDIS_URL` 有值时 `redis` 字段来自 TCP 建连，不是 `PING`。停 Redis 后仍可能 200，且实测出现过 `redis: true`。
- **期望**：Redis 是 compose 硬依赖时，不可达应让 health 失败（或至少 `ok: false` + `redis: false`）。探测应是 Redis 协议，不只是端口通。
- **复现**：`docker compose -p tokenhub stop redis` 再 `GET /health`。

**Context**

HLD V1 要求 PG+Redis。限流/缓存仍在进程内，Redis 挂了网关热路径还能转。健康检查语义需要先定：依赖探活 vs 进程存活。回归按「依赖探活」判定为缺口。

**Proposed Solution**

`redis` 失败时 `ok: false` 且非 200；探测改为发 `PING`。进程内 T1 的 `/health`（hub stub）保持简单 200，避免夹具依赖 Redis。

---

## 不入库

| 项 | 原因 |
|----|------|
| DeepSeek 官方 401 | 凭据无效，不是产品缺陷。换有效 Key 后再做真实冒烟。 |
| 控制台体验差 | 功能债，走 feature-manager，不记 issue。 |
| 预算/限流主要靠 SQL 配 | 与体验债合并，不当安全阻断。 |

## Summary

| 指标 | 数量 |
|------|------|
| Total | 5 |
| Open / needs-info / ready | 3 |
| Resolved | 2 |
| High | 1 open / 2 resolved |
| Medium | 2 |
| Low | 0 |

Next to resolve: **002**（发布镜像嵌入陈旧前端）。
