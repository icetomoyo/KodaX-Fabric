# 07 — Provider、Provider Key 与 Model 登记

**What to build:** 管理员在管理台登记 OpenAI 系 / Anthropic 系 Provider、加密存放的 Provider Key，以及 `model` 字符串到唯一一对 Provider + Provider Key 的映射。停用 Model 或 Provider 后新调用拒绝。配置不再依赖种子上游。

**Blocked by:** 01 — OpenAI 非流式透传与第一条 Request

**Status:** ready-for-agent

- [ ] 管理员可登记 OpenAI 系（含兼容 base URL）与 Anthropic 系 Provider，并写入 Provider Key
- [ ] Provider Key 明文不出现在之后的管理台响应、网关响应和日志里
- [ ] 每个 `model` 只能挂一对 Provider + Provider Key；不能做别名或同 model 双 Key
- [ ] 用管理台登记的 Model 可以完成一次透传并落 Request
- [ ] 停用 Model 或 Provider 后新调用拒绝，不打到 Provider
