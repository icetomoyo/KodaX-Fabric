# 03 — Provider Key 拆出与 Channel 池

**What to build:** Provider 只留家族 + base URL。Provider Key 属于 Provider。Channel = (Model, Provider Key) + 权重 + 优先级 + 成本价。同一 `model` 可选池。无成本价不入选。只有超级管理员能改线路。

**Blocked by:** 01 — 企业、Team 成本桶、超级管理员

**Status:** resolved

- [x] 超级管理员可为同一 Provider 建两把 Key，并为同一 model 建两条 Channel
- [x] 调用方仍只传 `model`；池里至少一条可调用 Channel 才能过网关
- [x] 没有成本价的 Channel 不会被选中；整池都不可调用 → 拒绝且不打上游
- [x] 同一 (Model, Provider Key) 第二条 Channel → 409
- [x] 企业管理员 / 团队侧 API 看不见密钥明文

## Answer

Provider 仍是家族 + base URL；`POST /admin/api/providers` 带 `api_key` 时同时写入第一把 Provider Key。`POST /admin/api/providers/{name}/keys` 再加 Key。`POST /admin/api/channels` 建 (Model, Provider Key) + 权重/优先级/成本价；同一对 409。有 Channel 的 model 只从可调用池里选（未停、Key/Provider 未停、有价、家族匹配）；整池不可用 → 400 `no_price` 且不打上游。无 Channel 的种子 model 仍走 P1 价格表。企业管理员/开发者打线路 API → 403，Key 列表不含明文。

Context: `internal/fabric/channel_test.go`.
