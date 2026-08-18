# Request 行不可改

账本原则是 append-only。价格记错、计量补记，只能以后追加 Adjustment，不能 UPDATE Request。

P1 不实现 Adjustment。在那之前，错账先留着。允许改行会让「按价格表可复算」失去唯一历史。
