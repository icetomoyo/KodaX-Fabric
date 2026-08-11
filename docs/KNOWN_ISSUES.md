# KNOWN_ISSUES

Last Updated: 2026-08-11

## Issue Index

| ID | Title | Priority | Status | Introduced |
|----|-------|----------|--------|------------|
| 001 | 日 Token 触顶时客户端只见 Retry，不像「额度用尽」 | High | ready | v0.0.5 |

## Issue Details

### ISSUE_001: 日 Token 触顶时客户端只见 Retry，不像「额度用尽」

| 字段 | 内容 |
|------|------|
| Priority | High |
| Status | **ready**（可排期修复） |
| Introduced | v0.0.5 |
| Created | 2026-08-11 |
| Reporter | 张闯 |

#### Original Problem

**当前行为**

- 管理端将员工日 Token 硬上限设为 **50,000** 后，多轮对话触顶。
- Claude Code 侧出现类似：`API error · Retrying in 2s · attempt 3/10`，表现为重试/断开感，而不是清晰的「今日额度已用完」。
- 作为 LLM 网关，员工难以区分：真故障 / 限流 / 额度用尽。

**期望行为**

- 触达日 Token 硬上限时，按 **OpenAI / Anthropic 各自协议**返回明确、可展示的错误（文案或 error type 能表达「今日 Token 配额已用尽」）。
- 客户端应尽量**不要**把该错误当成可无限重试的瞬时上游故障（若协议允许：不可重试或明确 insufficient_quota / 等价语义）。
- 员工一看就知道：是额度问题，找管理员调配额或等次日重置，而不是以为网关挂了。

**复现步骤**

1. 管理端将默认日 Token 上限改为较小值（如 50000）。
2. 员工用 Claude Code（`anthropic_messages` Key）连续对话直到触顶。
3. 观察客户端错误展示与 HTTP 响应体。

**Context**

- 服务端已有 `RelayLimitError("今日 Token 配额已用尽", "daily_token_limit_exceeded")`，并多以 **HTTP 429** + `rate_limit_error` 类 envelope 返回（见 `server/src/lib/relay/quota.ts` 与 chat/messages 路由）。
- 问题更可能在于：**状态码/error type 与「日配额」语义不对齐**，导致 Claude Code 等客户端走通用 Retry 文案。
- 公测配额基线已定为 5 万/人/日（见 pilot-charter §5）。

**Root Cause（初步）**

- 待实现时确认：日配额是否与 RPM/并发共用 429 + `rate_limit_error`；Anthropic/OpenAI 错误体字段是否足以让官方客户端停止重试并展示业务文案。

**Proposed Solution（方向，未实现）**

1. 日配额错误使用更贴切的 HTTP/错误类型（若兼容允许：如 429 保留但 type/message 固定为配额语义；或评估 402/403 等与客户端行为）。
2. OpenAI / Anthropic 两路 envelope 的 `message` 必须稳定含「今日 Token 配额已用尽」或等价中英文，且 `code` 为 `daily_token_limit_exceeded`（或协议惯用 insufficient_quota）。
3. 接入教程 / 排障文档补充：「若见 Retry 且管理端显示今日 Token 已满 → 即额度问题」。
4. 加单测：触顶时响应体与状态码契约。

## Summary

| 指标 | 数量 |
|------|------|
| Total | 1 |
| Open / needs-info / ready | 1 |
| Resolved | 0 |
| High | 1 |

Next to resolve: **001**（日配额触顶错误体验）
