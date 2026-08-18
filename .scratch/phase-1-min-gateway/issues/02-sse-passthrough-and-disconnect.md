# 02 — SSE 透传与客户端断开

**What to build:** 同一把 Virtual Key、同一个 OpenAI 系端点，流式调用逐 chunk 与 fixture 一致；客户端断开则取消上游；无论断开时有没有 Usage，都落一条 Request。

**Blocked by:** 01 — OpenAI 非流式透传与第一条 Request

**Status:** ready-for-agent

- [x] 流式 `POST /v1/chat/completions` 的 SSE 序列与 fixture 一致，不整段缓冲
- [x] 客户端断开后上游被取消，不再继续消耗 fixture/上游
- [x] 最后 chunk 带 Usage 则按有 Usage 入账；没有则 token 与成本为 0，状态仍记下
- [x] 计量写入不挡住已发出的 chunk
- [x] 网关自身开销（fixture 立即返回）P99 < 50ms
