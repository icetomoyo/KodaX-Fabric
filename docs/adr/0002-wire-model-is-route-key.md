---
status: superseded by ADR-0010
---

# 路由键就是线路上的 model 字符串

P1 用请求体里的 `model` 唯一选定一对 Provider + Provider Key。未登记则拒绝。不做别名，不同 Key 共用一个 model。

别名和同模型多 Key 是后来的渠道池 / Fallback。现在若做，查找键和 SDK 传入值会分叉，调用方无法从错误里看出自己传了什么。

P2 起：查找键仍是线路上的 `model`，但它选出的是 Channel 池，不再是一对。见 ADR-0010。一对一那半句作废；「查找键 = SDK 传入值、不做别名」仍有效。
