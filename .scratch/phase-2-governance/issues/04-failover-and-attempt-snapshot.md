# 04 — 同 model failover 与 Attempt 快照

**What to build:** 写出任何响应之前，按优先级/权重换 Channel。400/422 不换。最多 3 次、默认 30s。一次入口一粒 Request：usage/状态看最终 Attempt，cost 看各次之和。快照写在 Request 上。调用方看见最后一次，看不见线路。

**Blocked by:** 03 — Provider Key 拆出与 Channel 池

**Status:** resolved

- [x] 第一条 Channel 返回 500 时，调用方收到第二条的成功体，且只入账一粒 Request
- [x] 该 Request.cost 为两次有 Usage 的成本之和；usage 来自成功那次；快照含两次 Attempt
- [x] 第一条返回 400 时不换路，调用方看见 400
- [x] 流式已写出响应后不再换路
- [x] 调用方响应无 Channel 名；平台控制台 Request 能看见快照

## Answer

写出任何响应之前按优先级换 Channel。触发 429/5xx/401/403/404/超时/传输失败；400/422 不换。最多 3 次、单次 30s。一次入口一粒 Request：usage/状态看最终 Attempt，cost 看各次之和。`GET /admin/api/requests` 的 `attempts` 含 Channel id、状态、Usage、成本、是否被调用方看见。调用方 body/头没有 Channel。

Context: `internal/fabric/failover_test.go`.
