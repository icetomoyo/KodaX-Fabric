# 调用方看见最后一次 Attempt，看不见线路

全池失败时若包一层 Fabric 错误，调用方必须改解析，零转换透传当场结束。若返回第一次失败，failover 对调用方变成「我看见的不是最后发生的事」。

调用方收到的状态和 body 就是最终 Attempt 的（传输失败、没有上游 body 时与 P1 一样 `502 provider`）。可以打 Fabric Request id、预算软限制/剩余、限流剩余。不打 Channel、Provider、Provider Key、Attempt 次数——线路只在管理台的 Request 快照里。
