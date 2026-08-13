# AGENTS.md

给后续会话的仓库事实。产品行为以 [docs/PRD.md](docs/PRD.md) §3 与 [docs/HLD.md](docs/HLD.md) 为准；切法以 [docs/token-hub-slices.md](docs/token-hub-slices.md) 为准。手测对照 [docs/TokenHub_VISION.md](docs/TokenHub_VISION.md) 人话版。

## 这是什么

KodaX Fabric 的核心模块是 **Token Hub**：企业 Token 统一接入。当前在分支 `token_hub` 上从 0 用 **Go 单进程**重写，目标是 **0.1.0 可独立部署**，供公司内部过渡使用（正式 Fabric 控制台尚未做）。

仓库里 **没有** 旧 Node 试点实现。不要从 git 历史把 Node `server/` / `web/` 找回来当基线。

## 文档怎么读

| 文档 | 用途 |
|------|------|
| `docs/PRD.md` | 产品需求。Token Hub 只看 §3 |
| `docs/HLD.md` | 架构：Go、零转换、V1 单进程、PG+Redis |
| `docs/token-hub-slices.md` | 已冻结的 0.0.1–0.1.0 切法。改切法先改这篇 |
| `docs/TokenHub_VISION.md` | PRD §3 抽出的 57 点 + 人话版（手测） |
| `docs/FEATURE_LIST.md` | 功能登记。目前只正式登记了 FEATURE_001 / v0.0.1 |
| `docs/features/v0.0.1.md` | 001 规格与票 |
| `docs/UI_DESIGN.md` | 17 屏线框，是愿景，不是 0.1.0 范围 |
| `docs/ProductDraft.md` | 早期设想（容量控制面叙事）。**不要当合同、不要当入门** |

`FEATURE_LIST` 规则是一次只登当前要做的那一版；0.0.2–0.1.0 的能力是 goal 一口气收口的，没有对应 `docs/features/v0.0.x.md`。不要事后补一整套 feature 文档，除非用户明确要求走 feature-manager。

## 当前实现（2026-08-13）

能力上已按 0.1.0 六条收口在跑，但 `FEATURE_LIST` 里 0.1.0 仍标 In Progress，也还没打 git tag。

- **网关** `cmd/gateway`：`POST /v1/chat/completions`、`POST /v1/messages` 零转换透传；同一把 `fab-` VK 两个端点都能用。
- **模型**：VirtualKey → ChannelPool → Channel → ProviderKey。禁止调用方钥匙硬绑单渠。禁止跨协议 fallback。
- **硬拒绝**：RPM 429、VK 预算 402、渠熔断 503。
- **管理 API** 在 `internal/admin`，路径是扁平的现网实现，**不是** HLD 里那套 `/providers/{id}/channels`。UI 必须跟代码字段名，不要按 HLD 重画 API。
- **角色** 现网只有 `admin` / `developer`。不要先做四角色（super_admin / org_admin / team_admin）。
- **不进 0.1.0**：ROI、Commerce、ClickHouse、SSO、17 屏控制台、聊天试玩。

`GET /api/v1/auth/me`：无会话返回 **200** `{"ok":true,"data":null}`（不要改回 401，控制台会刷红）。真正未授权的写接口仍是 401。

## 操作台

不是独立前端产品。`web/` 是 Vite + React + TS + shadcn 源码；`npm run build` 写到 `internal/webui/dist`，由 Go `embed` 同源提供 `/`、`/admin`、`/me`、`/assets/`。

- **不要删** `internal/webui`：那是嵌产物和页面 handler，不是旧 HTML。旧 `static/admin.html` 已删除。
- 改 UI：改 `web/src` → `cd web && npm test && npm run build` → 重建 gateway 镜像。
- 开发时 Vite 听 `8080`，反代 `127.0.0.1:3000`。Cookie 是 `th_session`，HttpOnly，SameSite=Lax。
- 客户端只序列化现有 JSON：`web/src/lib/api.ts`。加字段先改 Go。

## 本机怎么跑

compose 项目名 `tokenhub-goal`，文件 `deploy/compose.yaml`。

| 服务 | 宿主机端口 |
|------|------------|
| 网关 API | **3000**（容器内仍是 8080；可用 `TOKENHUB_API_PORT` 覆盖） |
| 操作台 | **8080**（同一进程再映一份；可用 `TOKENHUB_WEB_PORT` 覆盖） |
| Postgres | 15432 |
| Redis | 16379 |

```sh
# 健康
curl -fsS http://127.0.0.1:3000/health

# 改完代码后只重启网关（库已有种子时）
docker compose -p tokenhub-goal -f deploy/compose.yaml up -d --build --no-deps gateway
```

页面：<http://127.0.0.1:8080/>  管理 <http://127.0.0.1:8080/admin>  申请 <http://127.0.0.1:8080/me>  
管理员：手机 `18612243416`，密码 `Hz@123456`。  
Cursor / Claude Code 的 Base URL 填 `http://127.0.0.1:3000`（不要带 `/v1`）。

网关进程要求环境变量 `DATABASE_URL` 与 `CREDENTIAL_ENCRYPT_KEY`（compose 里已写死一套本地值）。

**Bootstrap 坑**：`internal/bootstrap` 要求 `DEEPSEEK_API_KEY`。当前 shell 常常没这个变量，`compose up` 会在 bootstrap 退出 1，gateway 因 `depends_on` 起不来。库若已经种过（有 admin、deepseek provider），用 `--no-deps gateway` 即可。不要为了「完整 up」去把 Key 写进仓库。

种子 VK 名：`fab-local-bootstrap-01`（volume `tokenhub-goal_vkdata` 的 `/data/virtual-key.txt`）。

## 硬约束（曾经踩过）

1. 遵守 PRD + HLD，不要把 ProductDraft 当当前产品。
2. 从第一天就是 VK → Pool → Channel，不要长回「产品线 + 协议硬绑一把员工 Key」。
3. 双端点零转换：不改 body，不翻译 thinking / tools。
4. 同一把 `fab-` 走两个 `/v1` 端点。
5. 0.1.0 UI 只覆盖登录、管理员编目、开发者申请/一次性 reveal、接入说明。不要借机做 17 屏。
6. 需要走功能生命周期时用 `feature-manager`；用户没说加 feature 就不要自动 Add 0.0.2。

## 建议的下一步（未做）

- `FEATURE_LIST` 与 tag：能力已按 0.1.0 收口，文档/发版手续未做完。
- 正式 `compose up` 仍依赖本机 `DEEPSEEK_API_KEY`（bootstrap），对「只重启网关」不挡，对干净环境首启会挡。
- 操作台还可以继续打磨，但不要扩成 Fabric 全控制台。
- 未提交的工作区改动（Go 网关、`web/`、embed dist）若还在，先确认要不要 commit。
