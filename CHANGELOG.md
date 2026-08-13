# Changelog

## [Unreleased]

Token Hub 按 PRD §3 + HLD 从 0 重建（Go 网关）。

---

## [0.0.6] - 2026-08-13

### Added

- VK / Provider 令牌桶 RPM + burst，超限 429（dimension 可区分）。
- 渠滑动窗口与连续失败熔断、半开探测；`GET /health/limits`。热状态内存（`HotLimits`）。

---

## [0.0.5] - 2026-08-13

### Added

- VK → Project → Team → ChannelPool → Provider Key；查询层禁止跨团队渠/官方 Key。
- 池分组 premium / standard / bulk，写入审计与 `X-Fabric-Pool-Group`。

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
