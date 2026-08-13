# Token Hub 发布 / 回滚 / 备份

工作目录：仓库根。compose 在 `deploy/compose.yaml`。本机默认对外 **API 3000**、**操作台 8080**（同一网关进程；可用 `TOKENHUB_API_PORT` / `TOKENHUB_WEB_PORT` 覆盖）。

## 健康

```sh
curl -fsS http://127.0.0.1:3000/health
```

期望 `ok: true`，`postgres`/`redis` 为 true。

## 发布

```sh
export DEEPSEEK_API_KEY='…'
docker compose -p tokenhub-goal -f deploy/compose.yaml build
sh deploy/backup.sh
docker compose -p tokenhub-goal -f deploy/compose.yaml up -d --wait
curl -fsS http://127.0.0.1:3000/health
```

页面（shadcn）：`http://127.0.0.1:8080/` 首页、`/admin` 管理员、`/me` 开发者申请 VK。调用 Origin：`http://127.0.0.1:3000`。

## 回滚

将 `deploy/compose.yaml` 里 gateway `image:` 改回上一已知良好 tag（或 `git checkout` 上一版后 `compose up -d --build`），再 `up -d`。先备份再回滚。

## 备份 / 恢复

```sh
sh deploy/backup.sh
# 产物：backups/tokenhub-YYYYMMDD-HHMMSS.sql.gz
```

恢复到演练库（不要直接打生产库）：

```sh
gunzip -c backups/tokenhub-XXXX.sql.gz | docker compose -p tokenhub-goal -f deploy/compose.yaml exec -T postgres psql -U tokenhub -d tokenhub
```

Redis 只存热限流，不进备份。
