# KodaX-Fabric / Token Hub

企业级 Token 统一接入网关（HLD V1：Go 单进程 + PostgreSQL + Redis）。

遵守 [docs/PRD.md](docs/PRD.md) 与 [docs/HLD.md](docs/HLD.md)。当前发布 **v0.1.0**。

| 项 | 说明 |
|----|------|
| 对外 | `POST /v1/chat/completions`（OpenAI）与 `POST /v1/messages`（Anthropic），同一把 `fab-` VK |
| 管理 | 操作台 `/` `/admin`（同源 embed）；API `/admin/v1/*`，请求头 `X-Admin-Token` |
| 健康 | `GET /live` 存活；`GET /health` 同时检查 PostgreSQL + Redis |

## 无真实 Key 本地启动

```sh
cd deploy
docker compose -f compose.yaml up --build --wait
```

默认走仓库内 mock-provider，不需要 `DEEPSEEK_API_KEY` / OpenAI / Anthropic Key。

- Origin：`http://127.0.0.1:3000`
- 操作台：<http://127.0.0.1:3000/admin>（登录 token 仅 local：`dev-local-admin-token`）
- 调用 VK：`fab-local-bootstrap-01`
- 管理 token（**仅 local**）：`dev-local-admin-token`
- Claude Code：Base URL `http://127.0.0.1:3000`，Anthropic 风格，`x-api-key: fab-local-bootstrap-01`
- Cursor：Base URL `http://127.0.0.1:3000/v1`，OpenAI 风格，`Authorization: Bearer fab-local-bootstrap-01`

```sh
./deploy/scripts/smoke.sh http://127.0.0.1:3000
```

## 环境变量

见 [.env.example](.env.example)。生产必须设置 `DATABASE_URL`、`REDIS_URL`、`CREDENTIAL_ENCRYPT_KEY`、`ADMIN_TOKEN`；不要使用 compose 里的开发默认值。

`CACHE_TTL` 为 Go duration，默认 `1h`，非法值拒绝启动。

## 发布 / 回滚 / 备份

镜像必须用不可变 `IMAGE_TAG`（必须含冒号，禁止空值与 `latest`）。smoke 地址读 `BASE_URL`；未提供时按 `GATEWAY_PORT`（默认 3000）生成。`--check` / `--dry-run` 不改外部状态。

```sh
IMAGE_TAG=kodax-fabric:v0.1.0 ./deploy/scripts/release.sh --check
IMAGE_TAG=kodax-fabric:v0.1.0 GATEWAY_PORT=3000 ./deploy/scripts/release.sh
BASE_URL=http://127.0.0.1:3000 IMAGE_TAG=kodax-fabric:v0.1.0 ./deploy/scripts/release.sh
./deploy/scripts/rollback.sh kodax-fabric:v0.1.0 --check
GATEWAY_PORT=3000 ./deploy/scripts/rollback.sh kodax-fabric:v0.1.0
./deploy/scripts/backup.sh
./deploy/scripts/restore.sh var/backups/tokenhub-YYYYMMDD-HHMMSS.sql.gz YES
```

Redis 热状态（缓存、RPM、预算）不进 PG dump，恢复后会重建。restore 会清空目标库 `public` schema，必须显式 `YES`。

## 故障排查

- `/health` 的 `postgres`/`redis` 为 false → 503，先查容器与连接串。
- 429：VK 或 Provider RPM；402：VK 月预算；熔断 503 `circuit_open`（熔断是本进程状态，不进 Redis）。
- 管理面 401：`ADMIN_TOKEN` 未配或错误。

## 文档

| 文档 | 用途 |
|------|------|
| [docs/features/v0.1.0.md](docs/features/v0.1.0.md) | 本版收口说明 |
| [docs/token-hub-slices.md](docs/token-hub-slices.md) | 0.0.1～0.1.0 切片 |
| [docs/FEATURE_LIST.md](docs/FEATURE_LIST.md) | Feature 索引 |
| [docs/TokenHub_VISION.md](docs/TokenHub_VISION.md) | 57 点手测 |
| [docs/HLD.md](docs/HLD.md) | 架构 |
