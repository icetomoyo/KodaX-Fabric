# 06 — 价格表与无价拒呼

**What to build:** 管理员在管理台维护每个 Model 一行 CNY 成本价（输入 / 输出 / 缓存）。没有价格行就不能调用；去掉价格后新调用拒绝。有 Usage 的 Request 成本可用价格表复算对上。

**Blocked by:** 01 — OpenAI 非流式透传与第一条 Request

**Status:** ready-for-agent

- [x] 管理员可以为已有 Model 写入或修改输入 / 输出 / 缓存单价（CNY）
- [x] 没有价格行的 Model 调用被拒绝，不打到 Provider
- [x] 去掉价格行后新调用被拒绝
- [x] 成功且有 Usage 的 Request 成本 = Usage × 对应单价，与报表一致
- [x] 无 Usage 的 Request 成本为 0
