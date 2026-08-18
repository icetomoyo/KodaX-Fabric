# 08 — Project × Model × 日 报表

**What to build:** 管理台用量页按 Project × Model × 日（Asia/Shanghai）聚合。多 Project 能分开看。token 之和等于各 Request 的 Usage 之和，成本之和可按价格表复算。

**Blocked by:** 05 — Project 绑定与 x-fabric-context; 06 — 价格表与无价拒呼

**Status:** ready-for-agent

- [ ] 报表三维为 Project × Model × 日，日界为 Asia/Shanghai
- [ ] 两个 Project 的调用不会记到同一格
- [ ] 一格内 token 数 = 这些 Request 的 Usage 之和（误差为 0）
- [ ] 一格内成本 = 各有 Usage 的 Request 按价格表复算之和
- [ ] 失败或无 Usage 的 Request 仍计入调用次数/状态，不把成本算成「免费成功」
