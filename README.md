# KodaX-Fabric

企业级 **Token 统一接入与效能管理** 平台（工作名 / 仓库名：**KodaX-Fabric**）。

**Token Hub** 按 [docs/fabric/PRD.md](docs/fabric/PRD.md) §3 从 0 重开（独立网关模块：VK、渠道池、限流熔断）。  
`https://tokenhub.haizhi.com` 是 2026 公司内试点，模型与文档已归档，不是模块基线。

| 项 | 说明 |
|----|------|
| 产品 | KodaX Fabric |
| 核心模块 | Token Hub（重开中，尚未登记 0.0.1） |
| 版本 | 新序列待定；试点包版本见 `package.json` / `CHANGELOG.md` |
| 愿景 | [docs/fabric/PRD.md](docs/fabric/PRD.md) · [docs/fabric/TokenHub_VISION.md](docs/fabric/TokenHub_VISION.md) |
| 试点现网 | `https://tokenhub.haizhi.com`（运维见 [归档 runbook](docs/archive/tokenhub-pilot/runbook-release.md)） |

## 开发

```sh
npm install
npm run dev          # API + Web
npm run build
npm test --workspace=@kodax-fabric/server
```

Workspaces：

- `@kodax-fabric/server` — Fastify API / Relay
- `@kodax-fabric/web` — Vue 管理端与员工端

## 部署

见 [deploy/README.md](deploy/README.md)。试点现网发布步骤：[docs/archive/tokenhub-pilot/runbook-release.md](docs/archive/tokenhub-pilot/runbook-release.md)。

## 文档

先看 [docs/README.md](docs/README.md)（阅读顺序与索引）。不要按文件名通读。

| 文档 | 用途 |
|------|------|
| [docs/README.md](docs/README.md) | 怎么看 |
| [docs/fabric/PRD.md](docs/fabric/PRD.md) | 原始产品需求（`main`） |
| [docs/fabric/TokenHub_VISION.md](docs/fabric/TokenHub_VISION.md) | Token Hub 愿景功能表 + 人话版 |
| [docs/FEATURE_LIST.md](docs/FEATURE_LIST.md) | 新基线 Feature 进度 |
| [docs/archive/tokenhub-pilot/](docs/archive/tokenhub-pilot/README.md) | 公司内试点归档 |
