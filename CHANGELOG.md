# Changelog

## [Unreleased]

Token Hub 按 PRD §3 + HLD 从 0 重建（Go 网关）。

---

## [0.0.4] - 2026-08-13

### Added

- 渠 priority / weight / models；priority=1 主路；同级按权重（按请求模型隔离 RR）。
- 同协议 429/5xx 换路（首次后再试最多 2 次），4xx 不重试。
- 模型别名同协议 fallback；`X-Fabric-*` 头 + `route_decisions` 持久审计。

---

## [0.0.3] - 2026-08-13

### Added

- 同一把 `fab-` VK 走 `/v1/chat/completions` 与 `/v1/messages`。
- VK `expires_at` 到期 401；`model_scope` 不在名单 403。
