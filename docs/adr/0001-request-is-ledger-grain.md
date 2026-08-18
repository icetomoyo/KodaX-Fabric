# Request 是账本的一粒

计量、成本和报表都挂在一次 HTTP 调用上，不挂在 Run 上。Run 只是 Request 上的可选分组键。

若按 Run 入账，P1 验收（单次 usage 对账）会对不齐，失败或未带 `run_id` 的调用会从账上消失。以后要纠错，追加 Adjustment，不改这条粒。
