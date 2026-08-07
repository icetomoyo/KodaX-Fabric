# TokenHub

公司内网 LLM 统一出口：官方供应商 Key 池共享、员工级全文审计、不计费。

> v0.0.5 功能实现与本地验证已完成；生产环境尚未部署。

📄 **产品需求文档（PRD）**：[docs/PRD.md](./docs/PRD.md)

- **后端**：Node.js + TypeScript + Fastify + Drizzle + Redis
- **前端**：Vue 3 + TypeScript + Vite + Element Plus
- **数据库**：使用本机 Colima 独立 Postgres / Redis（与 New API 隔离）

## 前置条件

1. Node.js ≥ 20.17（或 ≥ 22.9），npm 11
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

v0.0.4 采用干净数据库基线：全新环境执行迁移与最小种子即可。本地开发重建数据库会清空业务数据。

如果本地开发库执行过仍含 `openai_responses` 的旧版 `0000`，仅运行 `db:migrate` 不会重放已经登记的基线；需在确认无须保留业务数据后重建该隔离开发库，再执行 `npm run db:setup`。不要直接重建含有需要保留数据的环境。

## 快速开始

```sh
cd /Users/zhangchuang/haizhi_code/TokenHub

# 1) 生成 .env（从 colima 密码拼 DATABASE_URL / REDIS_URL）
cp .env.example .env
# 编辑 .env，填入密码与 JWT_SECRET 等

# 2) 安装依赖
npm install

# 3) 迁移 + 种子管理员
npm run db:setup

# 4) 启动 API + Web
npm run dev
```

- 本机 API: http://127.0.0.1:3100（默认避开本机 3000 占用）
- 本机 Web: http://127.0.0.1:5173
- 局域网 Web: `http://<本机局域网 IP>:5173`
- 局域网 API: `http://<本机局域网 IP>:3100`
- 健康检查: http://127.0.0.1:3100/health

开发服务器默认监听所有网卡，`npm run dev` 启动后 Vite 会在 `Network` 一栏打印局域网地址。macOS 也可以用 `ipconfig getifaddr en0` 查询当前 Wi-Fi IP；若其他设备无法连接，请确认两台设备在同一局域网，并允许 Node.js 通过系统防火墙。

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

治理变量：`QUOTA_TIMEZONE`（默认 `Asia/Shanghai`）、`RELAY_SAFEGUARD_RPM`（默认 `60`）和 `RELAY_SAFEGUARD_MAX_CONCURRENCY`（默认 `5`）。前者决定日 Token 配额的自然日边界，后两者是系统级稳定性保护，不在配额页面编辑。

### 创建 tokenhub 库（若尚未创建）

```sh
cd /Users/zhangchuang/Documents/Codex/2026-08-03/ben-d/work/colima-databases
set -a && source .env && set +a
docker compose exec -T postgres psql -U app -d postgres -c "CREATE DATABASE tokenhub OWNER app;"
```

## 角色与页面

| 角色 | 路径 | 能力 |
|---|---|---|
| 员工 | `/me/*` | 改密、API Key、自己的用量与日志、提交和查看自己的工单 |
| 管理员 | `/admin/*` only | 概览、员工、上游渠道、调用日志、配额、工单、操作审计（不进入员工端） |

管理后台菜单：概览 · 员工管理 · 上游渠道 · 调用日志 · 配额策略 · 工单管理 · 操作审计 · 个人中心。供应商、产品线和模型路由保留为内部数据结构，不再暴露独立页面。

模型代理已启用，员工统一使用 `/ai` Base URL。支持 OpenAI Chat Completions 和 Anthropic Messages 两种原生 API 转发，不做协议转换。当前入口为 `/ai/chat/completions`、`/ai/v1/messages` 与 `/ai/v1/messages/count_tokens`（员工 API Key）；网页 Chat 非一期范围。

## 模型代理使用

员工首次登录并完成改密后，在 Web 的「API Key」页面（`/me/keys`）依次选择上游渠道、该渠道的兼容协议并填写名称。每把员工 Key 固定绑定一个上游渠道和一种协议：OpenAI Chat Completions 或 Anthropic Messages；模型查询、调用和重试都不会跨出绑定渠道。完整明文仅在创建成功时向创建员工本人展示一次，关闭后员工和管理员均不能再次查看或复制；管理员的「员工管理」列表不显示或返回任何员工 Key 信息。以下示例中的值仅为占位符，不是真实 Key：

```sh
export TOKENHUB_API_KEY="th_replace_with_your_employee_key"
export TOKENHUB_BASE_URL="http://127.0.0.1:3100/ai"
```

原员工入口 `/v1/*` 已移除；已有客户端需要将 TokenHub Base URL 更新为 `/ai`。

生产或内网部署时，将 `TOKENHUB_BASE_URL` 替换为实际 TokenHub 地址。OpenAI Chat Completions 使用 Bearer；Anthropic Messages 同时接受原生 `x-api-key` 和 Bearer（若两者并存，值必须一致）：

```text
Authorization: Bearer <员工 API Key>
x-api-key: <Anthropic Messages 员工 API Key>
```

### 查询可用模型

`/ai/models` 只返回当前 Key 在绑定渠道和绑定协议下真实可调用的模型：

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

### 原生 Anthropic Messages

Messages 使用绑定“Anthropic Messages”协议的员工 Key；`anthropic-version` 必填，`anthropic-beta` 会安全透传：

```sh
curl -N "${TOKENHUB_BASE_URL}/v1/messages" \
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

Claude Code 的 `ANTHROPIC_BASE_URL` 与其他员工客户端统一填写 TokenHub Base URL（例如 `http://127.0.0.1:3100/ai`）。协议与上游渠道由员工 API Key 的绑定关系确定，员工侧不再按协议切换 Base URL。
可选的 `/ai/v1/messages/count_tokens` 也会原生直通，以便 Claude Code 获取精确上下文 Token 数。

### CC Switch 配置

在 CC Switch 中选择与员工 Key 完全一致的 API 格式，并填写：

| 配置项 | 值 |
|---|---|
| Base URL | 统一填写 TokenHub Base URL，部署后替换为实际地址 |
| API Key | 员工在 TokenHub 生成的 `th_...` Key |
| Model | 从 `GET /ai/models` 返回结果中选择 |

| 员工 Key 协议 | CC Switch API 格式 | Base URL | 实际入口 |
|---|---|---|---|
| OpenAI Chat Completions | OpenAI Chat Completions | `http://127.0.0.1:3100/ai` | `/ai/chat/completions` |
| Anthropic Messages | Anthropic Messages | `http://127.0.0.1:3100/ai` | `/ai/v1/messages` |

如果 CC Switch 分别要求 Host 和接口路径，按上表填写。不要把上游供应商 Key 配入 CC Switch。

### 调度、限流与审计

- 每个上游渠道可声明同时支持多个协议；TokenHub 先锁定员工 Key 绑定的 ProductLine，再按协议和可用状态选择该渠道内的上游凭证。同一请求重试时不会重复使用同一凭证，也不会切换到其他渠道。
- 管理端按供应商与产品线对渠道分组；渠道配置与聚合统计集中在“渠道详情”，Key 列表只承担脱敏后的 Key 级管理。
- 上游 `401/403` 会自动停用对应凭证，`429` 会进入短暂冷却，`5xx` 或网络错误可切换凭证重试；请求参数导致的 `400` 不重试。
- 绑定渠道停用时请求返回 `bound_channel_unavailable`；未配置显式映射的模型名会原样透传上游，由上游判断模型是否存在；全部冷却或无可用凭证分别返回 `model_channels_cooling`、`model_unavailable`。OpenAI 与 Anthropic 响应均保留确定性 `code`。
- 员工调用受单日总 Token 硬上限约束，并受固定 RPM/并发 safeguard 保护；超限时按当前协议返回 OpenAI 或 Anthropic 原生错误格式，RPM 超限响应会带 `Retry-After`。
- 成功、上游错误、限流和取消等调用都会写入员工级审计与用量记录；请求头中的员工 API Key 不会写入审计正文。
- 管理端结构化上下文仅管理员可读，并按用户提示词、返回信息、Skill/工具和元数据展示。员工查看自己的已保存正文维持不变。

## 常用命令

```sh
npm run dev:server      # 仅 API
npm run dev:web         # 仅前端
npm run db:migrate      # 执行迁移
npm run db:seed         # 仅种子管理员 + 最小系统配置（无演示供应商/凭证）
npm run db:cleanup-demo # 事务清理 Key、渠道和业务数据（保留员工账号与系统基线）
npm run db:generate     # 改 schema 后生成迁移
npm test --workspace=@tokenhub/server # 服务端默认单元测试（93 项）
npm run test:relay:mock --workspace=@tokenhub/server # 本地 PG/Redis + Mock 上游集成测试
npm run test:relay:native:mock --workspace=@tokenhub/server # Anthropic Messages 原生转发集成测试
npm run test:v001:api --workspace=@tokenhub/server # v0.0.1 Key/权限/数据库约束集成测试
npm run test:v001:binding --workspace=@tokenhub/server # v0.0.1 两种 API 的 A/B 渠道硬绑定集成测试
npm run test:v003:integration --workspace=@tokenhub/server # v0.0.3 用量、权限、正文脱敏与审计去重集成测试
npm run test:v005:integration --workspace=@tokenhub/server # v0.0.5 工单、员工隔离与角色权限集成测试
```

`test:relay:*` 和 `test:v001:*` 会使用当前配置的 PostgreSQL/Redis；只能在已完成 Migration 的隔离开发或测试环境运行，不要直接指向生产数据库。

`test:relay:live` 会真实调用已配置的上游并产生少量 Token，仅在明确需要时运行；必须用 `TOKENHUB_SMOKE_PRODUCT_LINE_ID=<渠道ID>` 指定硬绑定渠道，可用 `TOKENHUB_SMOKE_MODELS=model-a,model-b` 限定模型。


## 设计摘要

- 多官方供应商 ×（API / Coding Plan）凭证池  
- API 默认可公共共享；Coding Plan 默认授权制  
- 请求/响应审计（脱敏、单条容量上限与截断标记）；管理端正文仅管理员可见
- 不计费；按员工单日总 Token 硬上限 + 系统级 RPM/并发 safeguard
