# 价格挂在 Channel 上

P1（ADR-0006）每个 Model 一行价。池子跨两个上游时，同一 `gpt-4o` 会有两套成本；挂在 Model 上不是算贵了就是算便宜了，按价格表复算对的是假账。

每条 Channel 一行成本价。没有价格的 Channel 不能入选；一个 Model 的池里至少要有一条带价格的可调用 Channel，否则整模型拒绝。Request.cost 按各 Attempt 当时打的那条 Channel 的价计算。
