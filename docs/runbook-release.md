# KodaX Fabric · Token Hub 发布与备份恢复 Runbook（E1 / E2）

| 项 | 内容 |
|----|------|
| 产品 | **KodaX Fabric**（仓库 / monorepo 名） |
| 模块 | **Token Hub**（部署主机/镜像等可能仍带历史前缀 `tokenhub`） |
| 对应门槛 | **E1** 可重复发布 · **E2** 数据可托底 |
| 关联 | [公测章程](pilot-charter.md) · [deploy/README.md](../deploy/README.md) · [backup.sh](../deploy/backup.sh) |
| 生产入口 | `https://tokenhub.haizhi.com` |
| 工作目录 | 目标机上的仓库根目录；compose 在 `deploy/` |

> 本文供运维/管理员按步骤执行。**不要**把私钥、`.env` 密码写入工单或 Git。

---

## 1. 架构速览

| 服务 | 镜像（示例） | 职责 |
|------|----------------|------|
| `postgres` | `tokenhub-postgres:16-alpine` | 主数据 |
| `redis` | `tokenhub-redis:7-alpine` | 限流/并发/冷却等热状态（**不进 pg 备份**） |
| `api` | `tokenhub-api:…` | Fastify；启动时执行 `migrate` 再起服务 |
| `web` | `tokenhub-web:…` | Caddy 静态站 + 反代 `/api/*` `/ai/*` `/health` |

- 证书：宿主机 `/etc/tokenhub/tls/`（只读挂进 web 容器）  
- 运行密钥：`deploy/.env`（长期密钥；**不含**一次性 `SEED_ADMIN_PASSWORD`）  
- 本地备份目录：仓库根下 `backups/tokenhub-*.sql.gz`（脚本保留约 14 天）  

---

## 2. 发布前检查（E1）

在变更生产前逐项确认：

- [ ] 已读 [公测章程](pilot-charter.md) 中渠道/账号边界；本次变更不误开 Coding Plan 全员池  
- [ ] 新镜像已导入目标机（`pull_policy: never`，离线部署）  
- [ ] `deploy/compose.yaml` 中 `api` / `web` 的 `image:` 标签与本次发布一致  
- [ ] `deploy/.env` 存在且 `JWT_SECRET` / `CREDENTIAL_ENCRYPT_KEY` / DB / Redis 密码未丢失  
- [ ] TLS 文件存在且权限正确：  
  - 目录 `/etc/tokenhub/tls` → root、`0700`  
  - `haizhi.com_cert_chain.pem`、`haizhi.com_key.key` → root、`0600`  
- [ ] **先备份**：见 §4（发布前至少跑一次 `sh deploy/backup.sh`）  
- [ ] 维护窗口与回滚负责人已明确  

---

## 3. 首次部署（冷启动）

在目标机、已放入镜像与 `deploy/.env` 后：

```sh
cd /path/to/KodaX-Fabric/deploy

# 1) 仅数据面
docker compose up -d postgres redis

# 2) 一次性管理员（勿写入 .env）
SEED_ADMIN_PHONE='管理员手机号' \
SEED_ADMIN_PASSWORD='一次性强密码' \
SEED_ADMIN_NAME='管理员' \
sh bootstrap-admin.sh

# 3) 全量服务
docker compose up -d
```

验收：

```sh
# 容器健康
docker compose ps

# API 健康（容器内或经 Caddy）
curl -fsS https://tokenhub.haizhi.com/health
```

- 浏览器打开 `https://tokenhub.haizhi.com`，无证书告警  
- 管理员手机号登录 → 强制改密 → 进入 `/admin`  

`bootstrap-admin.sh` **只在空库/无管理员时**用于初始化；日常发布**不要**重复 seed 覆盖账号。

---

## 4. 日常备份（E2 · 备份侧）

### 4.1 命令

在**仓库根目录**或任意位置执行脚本（脚本会 `cd` 到 `deploy/`）：

```sh
cd /path/to/KodaX-Fabric
sh deploy/backup.sh
ls -lah backups/tokenhub-*.sql.gz | tail -5
```

成功时生成：`backups/tokenhub-YYYYMMDD-HHMMSS.sql.gz`（权限受 `umask 077` 约束）。

### 4.2 行为说明

- 对 compose 内 `postgres` 执行 `pg_dump`  
- gzip 压缩；删除超过约 **14 天** 的本地 `tokenhub-*.sql.gz`  
- **不含** Redis 数据（限流计数丢失可接受；上游凭证与业务在 Postgres）  
- **不含** 证书私钥与 `deploy/.env`（须另有机密保管流程）  

### 4.3 异地拷贝（必做）

本地 `backups/` 不够作为唯一灾备。每次重要发布后或按日：

```text
将 backups/tokenhub-*.sql.gz 拷贝到独立存储
（对象存储 / 备份机 / 加密盘），并限制访问权限。
```

部署说明中的「daily local schedule」若已在主机 crontab 配置，仍须确认异地拷贝任务存在。

---

## 5. 版本升级 / 滚动发布（E1）

适用：已在跑的生产，更换 `tokenhub-api` / `tokenhub-web` 镜像或 compose 配置。

### 5.1 步骤

```sh
cd /path/to/KodaX-Fabric

# 0) 备份
sh deploy/backup.sh

# 1) 导入新镜像（离线流程按你们制品库习惯）
#    docker load -i tokenhub-api-....tar
#    docker load -i tokenhub-web-....tar

# 2) 更新 deploy/compose.yaml 中 image 标签（与 load 的 tag 一致）

cd deploy

# 3) 重建并启动 api/web（postgres/redis 一般保持）
docker compose up -d api web

# 若改了 postgres/redis 环境，再：
# docker compose up -d

# 4) 观察
docker compose ps
docker compose logs --tail=100 api
curl -fsS https://tokenhub.haizhi.com/health
```

`api` 镜像入口为：`node server/dist/db/migrate.js && exec node server/dist/index.js`  
→ **迁移在新容器启动时自动执行**。迁移失败则容器反复重启，见 §6。

### 5.2 发布后快速验收

- [ ] `https://tokenhub.haizhi.com/health` 返回成功  
- [ ] 管理员可登录 `/admin`  
- [ ] 员工可登录 `/me`；抽查创建 Key 页可打开  
- [ ] 抽查一条真实调用或管理端日志列表可加载（维护窗口允许的范围内）  

更完整的 E10 清单见后续 `docs/release-checklist.md`（Ticket #5）。

---

## 6. 失败恢复路径（E1）

| 症状 | 处理 |
|------|------|
| 新 `api` 不健康 / 迁移报错 | `docker compose logs api`；**回滚镜像标签**到上一版本后 `docker compose up -d api`；保留失败日志；**不要**在未理解迁移的情况下强行 `migrate` 多次 |
| 仅 `web`/Caddy 异常 | 回滚 `web` 镜像；检查 `/etc/tokenhub/tls` 挂载与 Caddyfile |
| 证书错误 | 检查文件路径与权限；修正后 `docker compose restart web` |
| Postgres 起不来 | **先勿删 volume**；查磁盘与 `docker compose logs postgres`；需要时用 §7 从备份恢复 |
| 配置错误（`.env`） | 用变更前备份的 `.env` 恢复（机密流程内保管），再 `docker compose up -d` |
| 误操作导致数据损坏 | 停止写入 → §7 灾难恢复 |

**回滚镜像示例：**

```sh
cd deploy
# 将 compose.yaml 中 api/web image 改回上一已知良好 tag
docker compose up -d api web
curl -fsS https://tokenhub.haizhi.com/health
```

回滚**不能**自动撤销已成功应用的、向前不兼容的 DB 迁移。若迁移已写入且旧代码不兼容：优先修前向兼容或从 **迁移前备份** 做 §7 恢复（有数据损失窗口，需负责人批准）。

---

## 7. 数据库恢复（E2 · 恢复侧）

### 7.1 原则

- 恢复会覆盖或替换目标库数据，**须负责人批准**  
- 恢复前再打一份「当前」备份（若库仍可读）  
- Redis 不恢复：恢复后限流计数清空，属预期  

### 7.2 非破坏性演练（推荐作为首次 E2 证据）

在**同一 Postgres 实例**创建临时库，验证备份可读、可导入，**不动**生产库 `POSTGRES_DB`：

```sh
cd /path/to/KodaX-Fabric
# 使用最近一份备份
BACKUP=backups/tokenhub-YYYYMMDD-HHMMSS.sql.gz

cd deploy
# 以下变量与 compose 中 postgres 环境一致（也可 source .env）
set -a && . ./.env && set +a

# 创建演练库
docker compose exec -T postgres \
  sh -ec 'psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS tokenhub_restore_drill;"'
docker compose exec -T postgres \
  sh -ec 'psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE tokenhub_restore_drill;"'

# 导入
gunzip -c "../$BACKUP" | docker compose exec -T postgres \
  sh -ec 'psql -U "$POSTGRES_USER" -d tokenhub_restore_drill -v ON_ERROR_STOP=1'

# 抽查（表示例，以实际 schema 为准）
docker compose exec -T postgres \
  sh -ec 'psql -U "$POSTGRES_USER" -d tokenhub_restore_drill -c "\dt"'

# 清理演练库
docker compose exec -T postgres \
  sh -ec 'psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS tokenhub_restore_drill;"'
```

**通过标准**：导入无致命错误；`\dt` 能看到业务表（如 employees、request_audits 等）。

### 7.3 灾难恢复（覆盖生产库 · 高危）

仅在生产库不可用或确认需回档时：

```sh
cd /path/to/KodaX-Fabric
BACKUP=backups/tokenhub-YYYYMMDD-HHMMSS.sql.gz   # 或异地拷贝路径

cd deploy
docker compose stop api web

set -a && . ./.env && set +a

# 断开连接并重建业务库（库名以 .env 中 POSTGRES_DB 为准，下例为变量）
docker compose exec -T postgres sh -ec \
  'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE datname = current_setting('\''POSTGRES_DB'\'') AND pid <> pg_backend_pid();
SQL'

# 更稳妥：显式使用库名，例如 tokenhub：
# DROP DATABASE "tokenhub"; CREATE DATABASE "tokenhub";

gunzip -c "../$BACKUP" | docker compose exec -T postgres \
  sh -ec 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1'

docker compose up -d
curl -fsS https://tokenhub.haizhi.com/health
```

> 上面 `current_setting('POSTGRES_DB')` 在部分镜像中不可用时，**改为明文业务库名**（与 `.env` 的 `POSTGRES_DB` 一致）。  
> 生产执行前在维护窗口演练 §7.2，并双人复核命令。

---

## 8. 恢复演练记录（E2 证据）

> **完成 E2 签字前**，在目标环境至少做一次 §7.2（或批准的 §7.3），并填写下表。

| 字段 | 填写 |
|------|------|
| 演练类型 | ☑ **7.2 非破坏性临时库**　☐ 7.3 灾难恢复（须批准） |
| 环境 | ☑ 生产相关环境　☐ 其它：________ |
| 备份文件 | 执行人已用当时本地/主机备份验证（路径由执行人保管，不入库） |
| 备份生成时间 | 2026-08-11 前后（与演练同日） |
| 演练执行时间 | 2026-08-11 |
| 执行人 | 张闯 |
| 复核人 | 张闯（自测） |
| 结果 | ☑ **通过**　☐ 失败（原因：________） |
| 导入/抽查摘要 | 执行人确认备份可恢复、演练无问题 |
| 备注 | 用户口头确认「尝试了一下，没问题」；详细命令见 §7.2 |

**状态**：E2 首次演练记录已填写（2026-08-11）。重大发版前建议再跑一轮并追加一行。

---

## 9. 发布记录模板（E1 证据）

| 字段 | 填写 |
|------|------|
| 发布日期 | |
| 执行人 | |
| 变更说明 | （镜像 tag / 配置） |
| 发布前备份文件 | |
| 健康检查 | ☐ `curl …/health` 成功 |
| 回滚是否触发 | ☐ 否　☐ 是（原因：） |
| 备注 | |

---

## 10. 与公测章程的关系

| 门槛 | 本文章节 | 章程 |
|------|----------|------|
| E1 | §2–§3、§5–§6、§9 | [pilot-charter §10](pilot-charter.md) |
| E2 | §4、§7–§8 | 同上 |

员工接入见员工端 `/me/guide`（Ticket #3）。  
值班故障排查见 [runbook-troubleshoot.md](runbook-troubleshoot.md)（Ticket #4）。
