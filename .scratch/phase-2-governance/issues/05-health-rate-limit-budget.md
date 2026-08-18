# 05 — 熔断、限流、预算

**What to build:** Health 与管理员停用两根开关；成功 ⇔ 不会 failover；半开只 1 个探测。限流 per-VK + per-Team RPM，按入口计 1，先于上游。预算按成本：Team 可配、企业可选、无平台总闸。429/402 仍入账且 token/cost 0。

**Blocked by:** 04 — 同 model failover 与 Attempt 快照

**Status:** resolved

- [x] 最近窗口成功率按「会不会 failover」计；open 的 Channel 不入池；半开并发第二笔不走这条
- [x] 超 VK 或 Team RPM → 429，不打上游，有 Request
- [x] Team 硬预算越过 → 402，不打上游；企业闸独立；无平台总闸
- [x] failover 多次只扣 1 次 RPM；回来后按 Attempt 成本之和扣预算
- [x] 重启后限流与 Health 清空（进程内）

## Answer

Health 在进程内：成功 ⇔ 不会 failover；默认最近 100 次 < 80% 则 open，30s 后半开，半开只放 1 个探测。限流 VK/Team RPM，按入口计 1，先于预算先于上游；超限 429 且入账 token/cost 0。预算按成本，Team 可配、企业可选、无平台总闸；已越过硬闸 402。回来按 Attempt 成本之和扣。Health 与限流不落库，重启即空。

Context: `internal/fabric/gates_test.go`, `internal/fabric/gates.go`.
