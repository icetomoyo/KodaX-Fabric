# KodaX-Fabric

企业级 Token 统一接入与效能管理。发布 **v0.0.3**。当前落地模块是 **Token Hub**（HLD：Go 单进程网关）。

遵守 [docs/PRD.md](docs/PRD.md) 与 [docs/HLD.md](docs/HLD.md)。

| 项 | 说明 |
|----|------|
| 对外 | `POST /v1/chat/completions`、`POST /v1/messages`，调用方持 `fab-` VK |
| 控制台 | `/` 登录；管理员 `/admin`；开发者 `/app` |
| 健康 | `GET /health` |

## 本地启动

```sh
cd deploy
docker compose -f compose.yaml up --build --wait
```

- Origin：http://127.0.0.1:8080
- 登录：http://127.0.0.1:8080/
- 管理员：`18612243416` / `Hz@123456`
- 开发者：`13800138000` / `Dev@123456`

官方 Key 可在管理后台「上游钥匙」加密入库。未配置 `DEEPSEEK_API_KEY` 时仍能登录控制台。

## 文档

| 文档 | 用途 |
|------|------|
| [docs/PRD.md](docs/PRD.md) | 产品需求（Token Hub §3） |
| [docs/HLD.md](docs/HLD.md) | 高层设计（网关 Go、零转换、V1 单进程） |
| [docs/token-hub-slices.md](docs/token-hub-slices.md) | 0.0.1～0.1.0 切片 |
| [docs/TokenHub_VISION.md](docs/TokenHub_VISION.md) | 57 点 + 人话版（手测） |
| [docs/FEATURE_LIST.md](docs/FEATURE_LIST.md) | Feature 索引（当前 v0.0.3） |
| [docs/features/v0.0.3.md](docs/features/v0.0.3.md) | 本版规格与票 |
| [docs/UI_DESIGN.md](docs/UI_DESIGN.md) | 控制台线框 |
| [docs/ProductDraft.md](docs/ProductDraft.md) | 早期设想；不要当入门 |
