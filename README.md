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

## 文档

| 文档 | 用途 |
|------|------|
| [docs/PRD.md](docs/PRD.md) | 原始需求（Token Hub 见 §3） |
| [docs/token-hub-slices.md](docs/token-hub-slices.md) | 0.0.1～0.1.0 切片（已冻结） |
| [docs/TokenHub_VISION.md](docs/TokenHub_VISION.md) | 57 点 + 人话版（手测依据） |
| [docs/FEATURE_LIST.md](docs/FEATURE_LIST.md) | 当前 feature（只登 0.0.1） |
| [docs/HLD.md](docs/HLD.md) | 高层设计 |
| [docs/UI_DESIGN.md](docs/UI_DESIGN.md) | 控制台线框 |
| [docs/ProductDraft.md](docs/ProductDraft.md) | 早期设想；不要当入门 |
