# Local KodaX-Fabric / Token Hub (v0.0.7)

```sh
export DEEPSEEK_API_KEY='sk-...'
cd deploy
docker compose up --build
```

- Admin operator (bootstrap): phone `18612243416` / password `Hz@123456`
- Caller virtual key: `fab-local-bootstrap-01`
- Origin: `http://127.0.0.1:8080`
- `GET /health`
- `POST /v1/chat/completions` with `Authorization: Bearer fab-local-bootstrap-01`
