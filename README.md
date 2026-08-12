# KodaX-Fabric

企业级 Token 统一接入与效能管理。当前从 0 重建核心模块 **Token Hub**（HLD：Go 单进程网关）。

遵守 [docs/PRD.md](docs/PRD.md) 与 [docs/HLD.md](docs/HLD.md)。仓库里不再保留 Node 试点实现。

| 项 | 说明 |
|----|------|
| 产品 | KodaX Fabric |
| 模块 | Token Hub（FEATURE_001 / v0.0.1 进行中） |
| 栈 | Go 1.22+；V1 依赖 PostgreSQL + Redis（业务接上后再用） |

## 开发

```sh
go run ./cmd/gateway
# GET http://127.0.0.1:8080/health
```

页面：`/admin` 管理后台，`/me` 开发者申请 VK。  
Cursor / Claude Code 的 Base URL 填网关 Origin（本机 `http://127.0.0.1:18080`），同一把 `fab-` 钥匙两个端点都能用。

发布 / 备份见 [deploy/runbook.md](deploy/runbook.md)。

## 文档

| 文档 | 用途 |
|------|------|
| [docs/PRD.md](docs/PRD.md) | 产品需求（Token Hub §3） |
| [docs/HLD.md](docs/HLD.md) | 高层设计（网关 Go、零转换、V1 单进程） |
| [docs/token-hub-slices.md](docs/token-hub-slices.md) | 0.0.1～0.1.0 切片 |
| [docs/TokenHub_VISION.md](docs/TokenHub_VISION.md) | 57 点 + 人话版（手测） |
| [docs/FEATURE_LIST.md](docs/FEATURE_LIST.md) | FEATURE_001 |
| [docs/features/v0.0.1.md](docs/features/v0.0.1.md) | 规格与票 |
| [docs/UI_DESIGN.md](docs/UI_DESIGN.md) | 控制台线框 |
| [docs/ProductDraft.md](docs/ProductDraft.md) | 早期设想；不要当入门 |
