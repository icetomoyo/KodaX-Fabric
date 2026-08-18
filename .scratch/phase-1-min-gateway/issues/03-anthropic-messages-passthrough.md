# 03 — Anthropic Messages 透传

**What to build:** 开发者把 Anthropic SDK 的 `base_url` 和密钥换成 Fabric 与 Virtual Key 后，`POST /v1/messages` 非流式与流式都零转换通过；OpenAI 系端点不能打到 Anthropic 系 Model。

**Blocked by:** 02 — SSE 透传与客户端断开

**Status:** ready-for-agent

- [x] 非流式 Messages 响应体与 Anthropic 系 fixture 一致
- [x] 流式 Messages 的 SSE 与 fixture 一致；断开时取消上游并落 Request
- [x] Usage 只取自 Provider 响应，token 数与 fixture 中的 Usage 一致
- [x] OpenAI 系端点请求一个登记在 Anthropic 系的 `model` 被拒绝，且不打到 Provider
- [x] 未开放的 Anthropic 其它路径被拒绝
