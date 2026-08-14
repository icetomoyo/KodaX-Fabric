# Local KodaX-Fabric / Token Hub (v0.1.3)

Compose 项目名：**`tokenhub`**。单进程 Gateway + PostgreSQL + Redis。

## 发布

```sh
export DEEPSEEK_API_KEY='sk-...'   # 可选；没有也能登录控制台
cd deploy
docker compose -p tokenhub -f compose.yaml up --build --wait
```

镜像构建会先 `npm run build` 再 embed 控制台，侧栏含团队项目 / 路由审计。

- Origin：`http://127.0.0.1:8080`
- 登录：http://127.0.0.1:8080/
- 企业管理员（`org_admin`）：`18612243416` / `Hz@123456`
- 开发者（`developer`）：`13800138000` / `Dev@123456`
- 团队管理员（`team_admin`）无种子账号，登录后由企业管理员在「用户」里创建（必须挂队）
- 本地调用方 VK：`fab-local-bootstrap-01`
- `GET /health` — Postgres 或（已配置 `REDIS_URL` 时）Redis `PING` 失败则非 200，`ok: false`
- IP 白名单默认只认 `RemoteAddr`。网关在反代后才设 `TRUST_PROXY=1`，才会认 `X-Forwarded-For` 第一段
- `POST /v1/chat/completions` `Authorization: Bearer fab-local-bootstrap-01`
- `POST /v1/messages` 同一把 `fab-`

Postgres 数据在命名卷 `pgdata`。重建容器不丢编目。

## 模型别名与 Provider RPM

生产路径已接通（ISSUE_003）：

- **Provider RPM**：`PATCH /console/v1/provider-keys/{id}` 设 `rpm_limit`。同 `provider_code` 共用桶；0 或不设 = 不限。VK 自己的 `rpm_limit` 仍独立生效。
- **模型别名**：`PUT /console/v1/model-aliases` `{"protocol":"openai_chat","model":"gpt-4","fallback":"gpt-4o"}`。网关启动时从库加载；主模型全挂后只改发出去的 `model`，不跨协议。`GET /console/v1/model-aliases` 列出。

## 回滚

1. 需要时先还原库：`./restore.sh backups/tokenhub.sql`
2. checkout 上一发布 git tag，再构建拉起：

```sh
git checkout v0.0.8   # 例：回到上一版
cd deploy
docker compose -p tokenhub -f compose.yaml up --build --wait
```

若发布时给镜像打过 tag，把 compose 里 `build:` 换成该 `image:` 后只 `up --wait`（不要 `--build`）。不引入独立编排器。

## 备份与还原

```sh
cd deploy
./backup.sh                      # 默认写 backups/tokenhub.sql
./restore.sh backups/tokenhub.sql
```

还原会先停 `gateway`，灌 dump，再 `up -d --no-deps gateway`（不重跑 bootstrap）。不要用无 `--no-deps` 的 `compose up` 收尾，否则 bootstrap 会盖掉还原数据。`compose start` 不支持 `--no-deps`。不断言 Redis。

## 双端同一把钥匙

同一把 `fab-`（本地可用 `fab-local-bootstrap-01`）：

| 客户端 | Base URL | 端点 |
|--------|----------|------|
| Cursor | `http://127.0.0.1:8080` | `POST /v1/chat/completions` |
| Claude Code | `http://127.0.0.1:8080` | `POST /v1/messages` |

官方 Key 只进管理后台「上游钥匙」，不得出现在 `/v1` 响应。

## 0.1.0 独立部署标准

| # | 标准 | 怎么勾 |
|---|------|--------|
| 1 | HLD V1：Go 单进程 Gateway；依赖 PostgreSQL + Redis | `compose` 三个常驻服务；限流/缓存仍在进程内，Redis 只作依赖并由 `/health` 探测 |
| 2 | 双端点 + `fab-`；调用方碰不到官方 Key | 上表同一把 VK；`/v1` 响应无 `sk-` 明文 |
| 3 | VK → 池 → 渠；同协议可 failover；禁止调用方钥匙硬绑单渠 | 001–008 行为不变；`go test ./...` |
| 4 | 限流 + 熔断 + 预算各有一种硬拒绝 | `go test ./...`（006 / 007） |
| 5 | 能发布/回滚/备份，`/health`，管理员能配 Key / 池 / 渠 / VK | 本文发布/回滚/备份；`GET /health`；控制台 `/admin` |
| 6 | Claude Code 与 Cursor 同一把 VK 走通 | 见「双端同一把钥匙」 |

官方 Key 可在管理后台加密入库。未配置 `DEEPSEEK_API_KEY` 时仍能登录控制台。
