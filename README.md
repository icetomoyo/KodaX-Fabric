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
| 管理员 | `/admin/*` only | 概览、员工、上游渠道、调用日志、日志授权、配额、操作审计（不进入员工端） |
| 审计员 | `/admin/*` only | 概览、调用日志（授权范围内，不进入员工端） |

管理后台菜单：概览 · 员工管理 · 上游渠道 · 调用日志 · 日志授权 · 配额策略 · 操作审计 · 个人中心。供应商、产品线和模型路由保留为内部数据结构，不再暴露独立页面。

模型代理已启用，原生支持 `/v1/chat/completions`、`/v1/responses`、`/v1/responses/compact`、`/v1/messages` 与 `/v1/messages/count_tokens`（员工 API Key）；网页 Chat 非一期范围。

## 模型代理使用

员工首次登录并完成改密后，在 Web 的「API Key」页面（`/me/keys`）选择协议并生成调用 Key。每个员工 Key 只绑定一种协议：OpenAI Chat Completions、OpenAI Responses 或 Anthropic Messages，不能跨协议调用。员工端仅在创建响应中展示明文；系统同时保留加密托管副本，管理员可在「员工管理」中按协议复制，且每次读取都会写入操作审计。以下示例中的值仅为占位符，不是真实 Key：

```sh
export TOKENHUB_API_KEY="th_replace_with_your_employee_key"
export TOKENHUB_BASE_URL="http://127.0.0.1:3100/v1"
```

生产或内网部署时，将 `TOKENHUB_BASE_URL` 替换为实际 TokenHub 地址。OpenAI Chat 与 Responses 使用 Bearer；Anthropic Messages 同时接受原生 `x-api-key` 和 Bearer（若两者并存，值必须一致）：

```text
Authorization: Bearer <员工 API Key>
x-api-key: <Anthropic Messages 员工 API Key>
```

### 查询可用模型

`/v1/models` 只返回当前员工有权使用且存在可用渠道的模型：

```sh
curl -sS "${TOKENHUB_BASE_URL}/models" \
  -H "Authorization: Bearer ${TOKENHUB_API_KEY}"
```

下面调用中的 `YOUR_MODEL_ID` 需替换为模型列表返回的 `id`。

### 非流式 Chat Completions

```sh
curl -sS "${TOKENHUB_BASE_URL}/chat/completions" \
  -H "Authorization: Bearer ${TOKENHUB_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "YOUR_MODEL_ID",
    "messages": [
      { "role": "user", "content": "请用一句话介绍 TokenHub。" }
    ],
    "stream": false
  }'
```

### 流式 Chat Completions

`curl -N` 会关闭输出缓冲，便于实时查看 SSE 数据：

```sh
curl -N "${TOKENHUB_BASE_URL}/chat/completions" \
  -H "Authorization: Bearer ${TOKENHUB_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "YOUR_MODEL_ID",
    "messages": [
      { "role": "user", "content": "分三点说明统一模型网关的价值。" }
    ],
    "stream": true
  }'
```

### 原生 OpenAI Responses

Responses 使用绑定“OpenAI Responses”协议的员工 Key。请求、响应、工具调用与语义化 SSE 事件按原生格式直通，不转换为 Chat Completions：

```sh
curl -N "${TOKENHUB_BASE_URL}/responses" \
  -H "Authorization: Bearer ${TOKENHUB_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "YOUR_MODEL_ID",
    "input": "请用一句话介绍 TokenHub。",
    "stream": true
  }'
```

Codex 长任务需要的 `POST /v1/responses/compact` 也按相同协议和鉴权原生直通。
`previous_response_id` 会通过 Redis 维持原生上游凭证亲和；当前未开放需要额外查询/取消接口的 `background` 和 `conversation` 模式，网关会明确返回 `unsupported_stateful_response`，不会随机发送到错误上游。

### 原生 Anthropic Messages

Messages 使用绑定“Anthropic Messages”协议的员工 Key；`anthropic-version` 必填，`anthropic-beta` 会安全透传：

```sh
curl -N "${TOKENHUB_BASE_URL}/messages" \
  -H "x-api-key: ${TOKENHUB_API_KEY}" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "YOUR_MODEL_ID",
    "max_tokens": 512,
    "messages": [
      { "role": "user", "content": "请用一句话介绍 TokenHub。" }
    ],
    "stream": true
  }'
```

Claude Code 的 `ANTHROPIC_BASE_URL` 应填写 TokenHub 服务地址本身（例如 `http://127.0.0.1:3100`），不要附加 `/v1`；Claude Code 会自行请求 `/v1/messages`。
可选的 `/v1/messages/count_tokens` 也会原生直通，以便 Claude Code 获取精确上下文 Token 数。

### CC Switch 配置

在 CC Switch 中选择与员工 Key 完全一致的 API 格式，并填写：

| 配置项 | 值 |
|---|---|
| Base URL | 按下表选择，部署后替换为实际地址 |
| API Key | 员工在 TokenHub 生成的 `th_...` Key |
| Model | 从 `GET /v1/models` 返回结果中选择 |

| 员工 Key 协议 | CC Switch API 格式 | Base URL | 实际入口 |
|---|---|---|---|
| OpenAI Chat Completions | OpenAI Chat Completions | `http://127.0.0.1:3100/v1` | `/v1/chat/completions` |
| OpenAI Responses | OpenAI Responses API | `http://127.0.0.1:3100/v1` | `/v1/responses` |
| Anthropic Messages | Anthropic Messages | `http://127.0.0.1:3100` | `/v1/messages` |

如果 CC Switch 分别要求 Host 和接口路径，按上表填写。不要把上游供应商 Key 配入 CC Switch。

### 调度、限流与审计

- 每个上游渠道可声明同时支持多个协议；TokenHub 先按员工 Key 协议过滤渠道，再按模型、授权范围、优先级与权重选择上游凭证。同一请求重试时不会重复使用同一凭证。
- 上游 `401/403` 会自动停用对应凭证，`429` 会进入短暂冷却，`5xx` 或网络错误可切换凭证重试；请求参数导致的 `400` 不重试。
- 员工调用受 RPM、并发和日配额约束；超出硬限制时按当前协议返回 OpenAI 或 Anthropic 原生错误格式，RPM 超限响应会带 `Retry-After`。
- 成功、上游错误、限流和取消等调用都会写入员工级审计与用量记录；请求头中的员工 API Key 不会写入审计正文。

## 常用命令

```sh
pnpm dev:server      # 仅 API
pnpm dev:web         # 仅前端
pnpm db:migrate      # 执行迁移
pnpm db:seed         # 仅种子管理员 + 最小系统配置（无演示供应商/凭证）
pnpm db:cleanup-demo # 清理非用户演示数据（保留 employees / api keys）
pnpm --filter @tokenhub/server db:generate  # 改 schema 后生成迁移
pnpm --filter @tokenhub/server test             # Relay 纯单元测试
pnpm --filter @tokenhub/server test:relay:mock  # 本地 PG/Redis + Mock 上游集成测试
pnpm --filter @tokenhub/server test:relay:native:mock # Responses/Messages 原生协议集成测试
```

`test:relay:live` 会真实调用已配置的上游并产生少量 Token，仅在明确需要时运行；可用 `TOKENHUB_SMOKE_MODELS=model-a,model-b` 限定模型。


## 设计摘要

- 多官方供应商 ×（API / Coding Plan）凭证池  
- API 默认可公共共享；Coding Plan 默认授权制  
- 全文 prompt/response 永久审计；管理员 + 授权可见  
- 不计费；软日上限 + RPM/并发治理  
