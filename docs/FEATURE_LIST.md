# FEATURE_LIST

Last Updated: 2026-08-13 15:00

## Version Info

| 项 | 值 |
|----|-----|
| Current Release | **v0.0.6** |
| Planned Version | — |

## Version Summary

| 版本 | 状态 | 进度 | 说明 |
|------|------|------|------|
| v0.0.1 | Released | 1/1 | 最小双端点网关 |
| v0.0.2 | Released | 1/1 | 上游钥匙柜 |
| v0.0.3 | Released | 1/1 | 虚拟钥匙，一把两端口 |
| v0.0.4 | Released | 1/1 | 渠道池 + 简单路由 |
| v0.0.5 | Released | 1/1 | VK 绑池 + 分组 |
| v0.0.6 | Released | 1/1 | 限流 + 熔断 |
| v0.0.7 | — | — | 预算闸 + 流式估算 |
| v0.0.8 | — | — | 缓存 + 运营面 |
| v0.1.0 | — | — | 独立部署收口 |

切法全文：[token-hub-slices.md](token-hub-slices.md)（遵守 PRD + HLD）。手测：[TokenHub_VISION.md](TokenHub_VISION.md)。

## Feature Index

| ID | Title | Status | Priority | Category | Planned | Design |
|----|-------|--------|----------|----------|---------|--------|
| 001 | 最小双端点网关 | **Completed** | Critical | New | v0.0.1 | [设计](features/v0.0.1.md#feature_001) |
| 002 | 上游钥匙柜 | **Completed** | Critical | New | v0.0.2 | [设计](features/v0.0.2.md#feature_002) |
| 003 | 虚拟钥匙一把两端口 | **Completed** | Critical | New | v0.0.3 | [设计](features/v0.0.3.md#feature_003) |
| 004 | 同协议多渠 failover | **Completed** | Critical | New | v0.0.4 | [设计](features/v0.0.4.md#feature_004) |
| 005 | VK 绑池与分组 | **Completed** | Critical | New | v0.0.5 | [设计](features/v0.0.5.md#feature_005) |
| 006 | RPM 硬拒绝与渠熔断 | **Completed** | Critical | New | v0.0.6 | [设计](features/v0.0.6.md#feature_006) |

## Feature Details

### FEATURE_001: 最小双端点网关

| 字段 | 内容 |
|------|------|
| ID | 001 |
| Title | 最小双端点网关 |
| Status | **Completed** |
| Priority | Critical |
| Category | New |
| Planned Version | v0.0.1 |
| Released Version | v0.0.1 |
| Created | 2026-08-13 |
| Started | 2026-08-13 |
| Completed | 2026-08-13 |
| Design | [docs/features/v0.0.1.md#feature_001](features/v0.0.1.md#feature_001) |

**Description**

Token Hub 按 `docs/PRD.md` §3 从 0 重开的第一刀：OpenAI / Anthropic 双端点零转换透传 + SSE。数据模型预留 VK → 池，即使本版池里只有一条路上游。

**Spec**：已综合（T1）。**Tickets**：#1–#4 **Done**。Go 网关 + compose 可独立拉起。

### FEATURE_002: 上游钥匙柜

| 字段 | 内容 |
|------|------|
| ID | 002 |
| Title | 上游钥匙柜 |
| Status | **Completed** |
| Priority | Critical |
| Category | New |
| Planned Version | v0.0.2 |
| Released Version | v0.0.2 |
| Created | 2026-08-13 |
| Started | 2026-08-13 |
| Completed | 2026-08-13 |
| Design | [docs/features/v0.0.2.md#feature_002](features/v0.0.2.md#feature_002) |

**Description**

管理员把官方 Key 加密存进网关；同一家可以挂多把并轮转；401 / 额度用尽的 Key 能停用，不再被选。手测：两把 Key 打流会摊，废 Key 不再打。

**Spec**：已综合（T1）。**Tickets**：#1–#4 **Done**。

### FEATURE_003: 虚拟钥匙一把两端口

| 字段 | 内容 |
|------|------|
| ID | 003 |
| Title | 虚拟钥匙一把两端口 |
| Status | **Completed** |
| Priority | Critical |
| Category | New |
| Planned Version | v0.0.3 |
| Released Version | v0.0.3 |
| Created | 2026-08-13 |
| Started | 2026-08-13 |
| Completed | 2026-08-13 |
| Design | [docs/features/v0.0.3.md#feature_003](features/v0.0.3.md#feature_003) |

**Description**

调用方只持 `fab-`；同一把 VK 走两个 `/v1` 端点；可限模型、可过期。

**Spec**：已综合（T1）。**Tickets**：#1–#3 **Done**。

### FEATURE_004: 同协议多渠 failover

| 字段 | 内容 |
|------|------|
| ID | 004 |
| Title | 同协议多渠 failover |
| Status | **Completed** |
| Priority | Critical |
| Category | New |
| Planned Version | v0.0.4 |
| Released Version | v0.0.4 |
| Created | 2026-08-13 |
| Started | 2026-08-13 |
| Completed | 2026-08-13 |
| Design | [docs/features/v0.0.4.md#feature_004](features/v0.0.4.md#feature_004) |

**Description**

同协议多渠：优先级主备、同级权重、5xx/429 换路、4xx 不换、模型别名 fallback、审计头回放。禁止跨协议。

**Spec**：已综合（T1）。**Tickets**：#1–#5 **Done**。

### FEATURE_005: VK 绑池与分组

| 字段 | 内容 |
|------|------|
| ID | 005 |
| Title | VK 绑池与分组 |
| Status | **Completed** |
| Priority | Critical |
| Category | New |
| Planned Version | v0.0.5 |
| Released Version | v0.0.5 |
| Created | 2026-08-13 |
| Started | 2026-08-13 |
| Completed | 2026-08-13 |
| Design | [docs/features/v0.0.5.md#feature_005](features/v0.0.5.md#feature_005) |

**Description**

VK → Project → Team → Pool → Provider Key。查询层隔离跨团队官方 Key。池分组 premium/standard/bulk。

**Spec**：已综合（T1）。

### FEATURE_006: RPM 硬拒绝与渠熔断

| 字段 | 内容 |
|------|------|
| ID | 006 |
| Title | RPM 硬拒绝与渠熔断 |
| Status | **Completed** |
| Priority | Critical |
| Category | New |
| Planned Version | v0.0.6 |
| Released Version | v0.0.6 |
| Created | 2026-08-13 |
| Started | 2026-08-13 |
| Completed | 2026-08-13 |
| Design | [docs/features/v0.0.6.md#feature_006](features/v0.0.6.md#feature_006) |

**Description**

VK + Provider 令牌桶突发后 429；渠熔断半开；`GET /health/limits`。热状态内存，`HotLimits` 留给 Redis。

**Spec**：已综合（T1）。

## Summary

| 指标 | 数量 |
|------|------|
| Total | 6 |
| Planned | 0 |
| In Progress | 0 |
| Completed | 6 |
| Critical | 6 |
