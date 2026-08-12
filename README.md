# KodaX-Fabric

企业级 **Token 统一接入与效能管理** 平台（工作名 / 仓库名：**KodaX-Fabric**）。

当前已落地的核心模块是 **Token Hub**（内网 LLM 统一网关、官方凭证池、员工级调用审计）。  
历史工程名 TokenHub 仅保留在生产域名、数据库名、Docker 镜像等**运行时标识**中，产品与仓库主体名称均为 **KodaX-Fabric**。

| 项 | 说明 |
|----|------|
| 产品 | KodaX Fabric |
| 核心模块 | Token Hub |
| 版本 | 见根目录 `package.json` / `CHANGELOG.md` |
| 公测说明 | [docs/token-hub/v0.1.0-closeout.md](docs/token-hub/v0.1.0-closeout.md) · [docs/token-hub/pilot-charter.md](docs/token-hub/pilot-charter.md) |
| 生产入口（现状） | `https://tokenhub.haizhi.com`（主机名历史沿用，产品名仍是 Fabric） |

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

见 [deploy/README.md](deploy/README.md) 与 [docs/token-hub/runbook-release.md](docs/token-hub/runbook-release.md)。

## 文档

先看 [docs/README.md](docs/README.md)（阅读顺序与索引）。不要按文件名通读。

| 文档 | 用途 |
|------|------|
| [docs/README.md](docs/README.md) | 怎么看、按角色阅读顺序 |
| [docs/fabric/PRD.md](docs/fabric/PRD.md) | Fabric 整机产品需求（愿景，未全部落地） |
| [docs/token-hub/TokenHub_PRD.md](docs/token-hub/TokenHub_PRD.md) | Token Hub 模块规则（已落地） |
| [docs/FEATURE_LIST.md](docs/FEATURE_LIST.md) | Feature 进度 |
| [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) | 已知问题 |
