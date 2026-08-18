# 线路上的 model 选出 Channel 池

P1（ADR-0002）用 `model` 唯一选定一对 Provider + Provider Key。P2 要在单渠道下线后把流量转到同一模型的其他 Key，一对一选不了备路。

查找键仍是调用方传入的 `model` 字符串，账本上的 Model 也是它。它选出的是该字符串下的一组 Channel（同一 Model + 不同 Provider Key + 权重 + 优先级），不是一对。不做别名，不把另一个 model 字符串当成这个 model。

拒绝「调用方传别名、内部再映射到真实模型」：查找键和 SDK 传入值分叉后，调用方无法从错误里看出自己传了什么。
