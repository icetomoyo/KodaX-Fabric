# 05 — 熔断、限流、预算

**What to build:** Health 与管理员停用两根开关；成功 ⇔ 不会 failover；半开只 1 个探测。限流 per-VK + per-Team RPM，按入口计 1，先于上游。预算按成本：Team 可配、企业可选、无平台总闸。429/402 仍入账且 token/cost 0。

**Blocked by:** 04 — 同 model failover 与 Attempt 快照

**Status:** ready-for-agent

- [ ] 最近窗口成功率按「会不会 failover」计；open 的 Channel 不入池；半开并发第二笔不走这条
- [ ] 超 VK 或 Team RPM → 429，不打上游，有 Request
- [ ] Team 硬预算越过 → 402，不打上游；企业闸独立；无平台总闸
- [ ] failover 多次只扣 1 次 RPM；回来后按 Attempt 成本之和扣预算
- [ ] 重启后限流与 Health 清空（进程内）
