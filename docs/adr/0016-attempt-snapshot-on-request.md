# Request.usage 看最终尝试，cost 看各次之和

一次入口仍是一粒 Request。Failover 时失败的 Attempt 也可能带 Usage。若只记最后一次，失败消耗从账上消失；若每次尝试都单开 Request，入口 HTTP 不再是一粒。

Usage 和状态来自最终 Attempt（调用方看见的那次）。cost 是各次有 Usage 的 Attempt 之和。每次 Attempt 的 Channel、状态、Usage、成本、是否被调用方看见，作为 Request 上的不可变快照一次写入。P2 不上 Adjustment，也不另做审计产品。复算用快照，不再假设 `cost = 当前价格表 × Request.usage`。
