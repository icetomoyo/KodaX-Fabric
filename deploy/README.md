# Local Token Hub (HLD V1)

无真实 LLM Key：

```sh
docker compose -f deploy/compose.yaml up --build --wait
./deploy/scripts/smoke.sh
# 或 GATEWAY_PORT=3010 时：
# BASE_URL=http://127.0.0.1:3010 ./deploy/scripts/smoke.sh
# 未设 BASE_URL 时按 GATEWAY_PORT（默认 3000）拼 Origin
```

- Admin token（仅 local）：`dev-local-admin-token`
- Caller VK：`fab-local-bootstrap-01`
- Origin：`http://127.0.0.1:${GATEWAY_PORT:-3000}`
- `GET /live` / `GET /health`（postgres + redis）
- `CACHE_TTL` 默认 `1h`
