# KNOWN_ISSUES

Last Updated: 2026-08-14 12:35

来源：v0.0.1→v0.1.0 累计回归（2026-08-14）。当前发布 **v0.1.0**，不建议判定生产完全落地。

## Issue Index

| ID | Title | Priority | Status | Introduced | Fixed |
|----|-------|----------|--------|------------|-------|
| 001 | IP 白名单可被伪造 X-Forwarded-For 绕过 | High | Resolved | v0.0.8 | unreleased (8ef74e0) |
| 002 | 发布镜像嵌入陈旧前端（缺 org/audit） | High | Resolved | v0.1.0 | unreleased (f089696) |
| 003 | 模型别名与 Provider RPM 未接入生产路径 | Medium | Resolved | v0.0.4 / v0.0.6 | unreleased (2628606) |
| 004 | restore 后再启 gateway 会重跑 bootstrap | High | Resolved | v0.1.0 | unreleased (3cac814) |
| 005 | Redis 挂了 /health 仍 200 | Medium | Resolved | v0.1.0 | unreleased (8849fb6) |

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
| Status | **Resolved** |
| Introduced | v0.1.0（源码路由已有，embed 未跟上） |
| Fixed | unreleased（`f089696`，在 v0.1.0 之后） |
| Created | 2026-08-14 |

**Original Problem**

- **当前**：源码 `web/src/app/router.tsx` 有 `/admin/org`、`/admin/audit`。`internal/webui/dist` 里 `admin-layout` 导航只有总览/用户/上游/池/渠/VK，没有团队项目和路由审计。`deploy/Dockerfile` 只 `COPY` 后 `go build`，不跑 `npm run build`。
- **期望**：镜像内嵌 SPA 与当前 `web/src` 一致；构建流水线在 embed 前重编前端。
- **复现**：`docker compose -p tokenhub --build` 打开 `/admin`，侧栏无「团队项目」「路由审计」。

**Context**

`//go:embed all:dist`。谁忘了在仓库里提交新 dist，发布就是旧 UI。这是发布门禁，不是产品能力缺口。

**Proposed Solution**

Dockerfile 增加 Node 阶段 `npm ci && npm run build`，把 `web/dist` 拷进 `internal/webui/dist` 再编 Go；或 CI 检查 dist 与源码同步。

**Resolution**

Dockerfile 增加 Node 阶段：`npm ci && npm run build`，再覆盖 `internal/webui/dist` 后编 Go。仓库 dist 已重编，侧栏含团队项目 / 路由审计。

- **Resolution Date**: 2026-08-14
- **Files Changed**: `deploy/Dockerfile`, `deploy/compose_test.go`, `internal/webui/ui_test.go`, `internal/webui/dist/**`, `deploy/README.md`
- **Tests Added**: `TestEmbeddedAdminHasOrgAndAudit`, `TestDockerfileBuildsFrontend`

---

### ISSUE_003: 模型别名与 Provider RPM 未接入生产路径

| 字段 | 内容 |
|------|------|
| Priority | **Medium** |
| Status | **Resolved** |
| Introduced | 别名 v0.0.4；Provider RPM v0.0.6 |
| Fixed | unreleased（`2628606`，在 v0.1.0 之后） |
| Created | 2026-08-14 |
| Rework | 2026-08-14 由「文档降级」改为生产接线 |

**Original Problem**

- **当前**：T1 可测 `Server.Aliases`、`ResolvedVK.ProviderRPM`。`cmd/gateway` 的 `hub.New` 不加载别名配置。`Postgres.ResolveVK` 不填充 `ProviderRPM`（无列可读）。生产 compose 这两项等于没接上。
- **期望**：要么生产可配置并生效，要么文档标明「仅夹具/未产品化」，避免当成已交付。
- **复现**：compose 栈无法靠配置打开模型别名；Provider 维 RPM 在 Postgres 路径恒为空，不限流。

**Context**

回归结论：部分能力只在单元测试接通。与 004/005 控制台配置债同类，但是网关热路径缺口。

**Rework**

第一次只写文档。已改为生产接线：`provider_keys.rpm_limit`、`model_aliases` 表、网关启动加载别名、`ResolveVK` 填 ProviderRPM、控制台 PATCH/PUT。本机 compose 已 `--build` gateway，migrate 已建表。

**Resolution**

生产路径接通，不再用「未产品化」搪塞。`PATCH provider-keys` 设 `rpm_limit`；`PUT/GET /console/v1/model-aliases` 配别名。

- **Resolution Date**: 2026-08-14
- **Files Changed**: `internal/store/*`, `internal/hub/console*.go`, `internal/hub/v003_prod_test.go`, `cmd/gateway/main.go`, `deploy/README.md`
- **Tests Added**: `TestProviderRPMFromCatalog`, `TestAliasesFromStore`

---

### ISSUE_004: restore 后再启 gateway 会重跑 bootstrap

| 字段 | 内容 |
|------|------|
| Priority | **High** |
| Status | **Resolved** |
| Introduced | v0.1.0 |
| Fixed | unreleased（`3cac814`，在 v0.1.0 之后） |
| Created | 2026-08-14 |
| Reopened | 2026-08-14（二次验证：`compose start` 不支持 `--no-deps`） |

**Original Problem**

- **当前**：`deploy/restore.sh` 在灌库后 `docker compose start gateway`。gateway `depends_on: bootstrap: service_completed_successfully`，Compose 会再拉起 bootstrap。bootstrap 对 operator / VK 是 `ON CONFLICT DO UPDATE`，会改写刚还原的初始化状态。
- **期望**：还原后只启动 gateway，不重跑 bootstrap，dump 里的数据保持原样。
- **复现**：改一条编目 → `./backup.sh` → 再改 → `./restore.sh` → 观察 bootstrap 容器再次 Started，种子数据被写回。

**Context**

009 收口的备份路径。第一次修复误用 `start --no-deps`。二次验证：Compose 报 `unknown flag: --no-deps`，灌库成功但 gateway 未拉起。

**Proposed Solution**

`docker compose up -d --no-deps gateway`（cleanup 同样）。测试须校验 `compose start --help` 无 `--no-deps`，并对 `up -d --no-deps --dry-run gateway` 做真实 CLI 校验。

**Resolution**

第一次误用 `start --no-deps`，CLI 报 unknown flag。改为 `up -d --no-deps gateway`。2026-08-14 本机 `tokenhub` 实跑：A 备份 → 改 B → restore，库回到 A，bootstrap `FinishedAt` 不变，gateway 再起，无 unknown flag。

- **Resolution Date**: 2026-08-14
- **Files Changed**: `deploy/restore.sh`, `deploy/compose_test.go`, `deploy/README.md`, `docs/KNOWN_ISSUES.md`
- **Tests Added**: `TestRestoreStartsGatewayWithoutDeps`（禁 `start --no-deps`）、`TestComposeUpNoDepsIsValid`（真实 `up --dry-run`）

---

### ISSUE_005: Redis 挂了 /health 仍 200

| 字段 | 内容 |
|------|------|
| Priority | **Medium** |
| Status | **Resolved** |
| Introduced | v0.1.0（health 覆盖层） |
| Fixed | unreleased（`8849fb6`，在 v0.1.0 之后） |
| Created | 2026-08-14 |

**Original Problem**

- **当前**：`GET /health` 的 HTTP 状态只看 Postgres。`REDIS_URL` 有值时 `redis` 字段来自 TCP 建连，不是 `PING`。停 Redis 后仍可能 200，且实测出现过 `redis: true`。
- **期望**：Redis 是 compose 硬依赖时，不可达应让 health 失败（或至少 `ok: false` + `redis: false`）。探测应是 Redis 协议，不只是端口通。
- **复现**：`docker compose -p tokenhub stop redis` 再 `GET /health`。

**Context**

HLD V1 要求 PG+Redis。限流/缓存仍在进程内，Redis 挂了网关热路径还能转。健康检查语义需要先定：依赖探活 vs 进程存活。回归按「依赖探活」判定为缺口。

**Proposed Solution**

`redis` 失败时 `ok: false` 且非 200；探测改为发 `PING`。进程内 T1 的 `/health`（hub stub）保持简单 200，避免夹具依赖 Redis。

**Resolution**

`REDIS_URL` 有值时发 RESP `PING`，无 `PONG` 则 503 且 `ok`/`redis` 为 false。裸 TCP 不算活。未配置 `REDIS_URL` 仍只看 Postgres。hub T1 `/health` 不变。

- **Resolution Date**: 2026-08-14
- **Files Changed**: `cmd/gateway/health.go`, `cmd/gateway/health_test.go`, `cmd/gateway/main.go`, `deploy/README.md`
- **Tests Added**: `TestPingRedisRejectsBareTCP`, `TestPingRedisAcceptsPong`, `TestHealthStatusRequiresRedisWhenConfigured`

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
| Open / needs-info / ready | 0 |
| Resolved | 5 |
| High | 0 open / 3 resolved |
| Medium | 0 open / 2 resolved |
| Low | 0 |

Next to resolve: 无。回归五条均已关闭。
