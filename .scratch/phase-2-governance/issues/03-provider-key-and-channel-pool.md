# 03 — Provider Key 拆出与 Channel 池

**What to build:** Provider 只留家族 + base URL。Provider Key 属于 Provider。Channel = (Model, Provider Key) + 权重 + 优先级 + 成本价。同一 `model` 可选池。无成本价不入选。只有超级管理员能改线路。

**Blocked by:** 01 — 企业、Team 成本桶、超级管理员

**Status:** ready-for-agent

- [ ] 超级管理员可为同一 Provider 建两把 Key，并为同一 model 建两条 Channel
- [ ] 调用方仍只传 `model`；池里至少一条可调用 Channel 才能过网关
- [ ] 没有成本价的 Channel 不会被选中；整池都不可调用 → 拒绝且不打上游
- [ ] 同一 (Model, Provider Key) 第二条 Channel → 409
- [ ] 企业管理员 / 团队侧 API 看不见密钥明文
