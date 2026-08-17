# 01 — OpenAI 非流式透传与第一条 Request

**What to build:** Compose 一条命令拉起 Fabric 与 PostgreSQL。用种子 Project、Virtual Key、Model、价格表，开发者把 OpenAI SDK 的 `base_url` 和密钥换成 Fabric 与这把 Virtual Key 后，非流式 `POST /v1/chat/completions` 的响应体与 OpenAI 系 fixture 一致，账上多一条 Request，管理台能看到这一天的成本。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [x] Compose 拉起后，持有效 Virtual Key 的非流式 Chat Completions 返回体与对应 fixture 一致（零转换）
- [x] 该调用 append 一条 Request：Virtual Key、Project、Model、Usage、成本、状态齐，且禁止事后改这条
- [x] 管理台能看到该 Project 这一日（Asia/Shanghai）的用量与成本
- [x] 未登记的 `model`、错误或缺失 Virtual Key、未开放路径均被拒绝，且不打到 Provider
- [x] 测试只打 HTTP 缝，Provider 用 fixture 回放，不打真实上游
