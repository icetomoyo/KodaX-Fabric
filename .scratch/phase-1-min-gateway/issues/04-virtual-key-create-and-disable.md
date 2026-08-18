# 04 — Virtual Key 创建与停用

**What to build:** 管理员在管理台创建 Virtual Key（明文只出现一次，只存哈希），并把它用于真实调用；停用后新请求立刻拒绝。种子 VK 可以被手建的取代。

**Blocked by:** 01 — OpenAI 非流式透传与第一条 Request

**Status:** ready-for-agent

- [ ] 管理员登录后可创建 Virtual Key，创建响应里能看到一次明文，之后再读看不到明文
- [ ] 用这把新 VK 可以打通已有的非流式透传并落 Request
- [ ] 停用后新请求立刻拒绝，不打到 Provider
- [ ] 无效 VK 与已停用 VK 都被拒绝
- [ ] 没有「轮换」动作；换秘密 = 新建一把再停用旧的
