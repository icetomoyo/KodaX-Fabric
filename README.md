# KodaX-Fabric

企业级 **Token 统一接入与效能管理** 平台（工作名 / 仓库名：**KodaX-Fabric**）。

**Token Hub** 按 [docs/PRD.md](docs/PRD.md) §3 从 0 重开。

| 项 | 说明 |
|----|------|
| 产品 | KodaX Fabric |
| 核心模块 | Token Hub（重开中） |
| 版本 | 见 `package.json` / `CHANGELOG.md` |
| 生产入口（试点现网） | `https://tokenhub.haizhi.com` |

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

见 [deploy/README.md](deploy/README.md)。

## 文档

`docs/` 仅保留 `main` 上的四篇原始设计：

| 文档 | 用途 |
|------|------|
| [docs/PRD.md](docs/PRD.md) | 产品需求（Token Hub 见 §3） |
| [docs/HLD.md](docs/HLD.md) | 高层设计 |
| [docs/UI_DESIGN.md](docs/UI_DESIGN.md) | 控制台线框 |
| [docs/ProductDraft.md](docs/ProductDraft.md) | 早期完整设想；与 PRD 用词不同，不要当入门 |
