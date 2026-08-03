# TokenHub

公司内网 LLM 统一出口：官方供应商 Key 池共享、员工级全文审计、不计费。

📄 **产品需求文档（PRD）**：[docs/PRD.md](./docs/PRD.md)

- **后端**：Node.js + TypeScript + Fastify + Drizzle + Redis
- **前端**：Vue 3 + TypeScript + Vite + Element Plus
- **数据库**：使用本机 Colima 独立 Postgres / Redis（与 New API 隔离）

## 前置条件

1. Node.js ≥ 20，pnpm ≥ 9
2. Colima 数据库服务已启动且 healthy：

```sh
cd /Users/zhangchuang/Documents/Codex/2026-08-03/ben-d/work/colima-databases
docker compose ps
```

| 服务 | 地址 |
|---|---|
| PostgreSQL 16 | `127.0.0.1:5432` |
| Redis 7 | `127.0.0.1:6379` |

默认使用独立库名 **`tokenhub`**（需已创建，见下方）。

## 快速开始

```sh
cd /Users/zhangchuang/haizhi_code/TokenHub

# 1) 生成 .env（从 colima 密码拼 DATABASE_URL / REDIS_URL）
cp .env.example .env
# 编辑 .env，填入密码与 JWT_SECRET 等

# 2) 安装依赖
pnpm install

# 3) 迁移 + 种子管理员
pnpm db:setup

# 4) 启动 API + Web
pnpm dev
```

- API: http://127.0.0.1:3100（默认避开本机 3000 占用）  
- Web: http://127.0.0.1:5173  
- 健康检查: http://127.0.0.1:3100/health  

默认种子管理员见 `.env` 中 `SEED_ADMIN_*`（首次登录会要求改密）。

### 用 colima 密码写 .env（不 echo 密码）

```sh
cd /Users/zhangchuang/Documents/Codex/2026-08-03/ben-d/work/colima-databases
set -a && source .env && set +a

cd /Users/zhangchuang/haizhi_code/TokenHub
cp -n .env.example .env

# macOS: 用 python 安全写入 URL（避免 shell 历史泄露可改用编辑器）
python3 - <<'PY'
import os, pathlib, re
root = pathlib.Path("/Users/zhangchuang/haizhi_code/TokenHub")
env_path = root / ".env"
text = env_path.read_text()
pg = os.environ["POSTGRES_PASSWORD"]
rd = os.environ["REDIS_PASSWORD"]
text = re.sub(r"^DATABASE_URL=.*$", f"DATABASE_URL=postgresql://app:{pg}@127.0.0.1:5432/tokenhub", text, flags=re.M)
text = re.sub(r"^REDIS_URL=.*$", f"REDIS_URL=redis://:{rd}@127.0.0.1:6379/1", text, flags=re.M)
env_path.write_text(text)
print("Updated DATABASE_URL and REDIS_URL in .env")
PY
```

并手动设置 `JWT_SECRET`、`CREDENTIAL_ENCRYPT_KEY`（可用 `openssl rand -base64 48`）。

### 创建 tokenhub 库（若尚未创建）

```sh
cd /Users/zhangchuang/Documents/Codex/2026-08-03/ben-d/work/colima-databases
set -a && source .env && set +a
docker compose exec -T postgres psql -U app -d postgres -c "CREATE DATABASE tokenhub OWNER app;"
```

## 角色与页面

| 角色 | 路径 | 能力 |
|---|---|---|
| 员工 | `/me/*` | 改密、API Key、自己的用量与日志 |
| 管理员 | `/admin/*` only | 概览、员工、供应商/产品线、凭证池、模型路由、调用日志、日志授权、配额、操作审计（不进入员工端） |
| 审计员 | `/admin/*` only | 概览、供应商只读、调用日志（授权范围内，不进入员工端） |

管理后台菜单：概览 · 员工管理 · 供应商/产品线 · 上游凭证池 · 模型路由 · 调用日志 · 日志授权 · 配额策略 · 操作审计。

模型调用走 `POST /v1/chat/completions`（员工 API Key），网页 Chat 非一期范围。

## 常用命令

```sh
pnpm dev:server      # 仅 API
pnpm dev:web         # 仅前端
pnpm db:migrate      # 执行迁移
pnpm db:seed         # 种子数据
pnpm --filter @tokenhub/server db:generate  # 改 schema 后生成迁移
```

## 设计摘要

- 多官方供应商 ×（API / Coding Plan）凭证池  
- API 默认可公共共享；Coding Plan 默认授权制  
- 全文 prompt/response 永久审计；管理员 + 授权可见  
- 不计费；软日上限 + RPM/并发治理  
