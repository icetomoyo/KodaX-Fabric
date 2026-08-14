# FEATURE_LIST

Last Updated: 2026-08-14 16:00

## Version Info

| 项 | 值 |
|----|-----|
| Current Release | **v0.1.1** |
| Planned Version | **v0.1.2** |

## Version Summary

| 版本 | 状态 | 进度 | 说明 |
|------|------|------|------|
| v0.0.1 | Released | 1/1 | 最小双端点网关 |
| v0.0.2 | Released | 1/1 | 上游钥匙柜 |
| v0.0.3 | Released | 1/1 | 虚拟钥匙，一把两端口 |
| v0.0.4 | Released | 1/1 | 同协议多渠 failover |
| v0.0.5 | Released | 1/1 | VK 绑池与分组 |
| v0.0.6 | Released | 1/1 | 限流 + 熔断 |
| v0.0.7 | Released | 1/1 | 预算闸 + 流式估算 |
| v0.0.8 | Released | 1/1 | 缓存 + 运营面 |
| v0.1.0 | Released | 1/1 | 独立部署收口 |
| v0.1.1 | Released | 1/1 | 回归补丁（KNOWN_ISSUES 001–005） |
| v0.1.2 | InProgress | 0/1 | 单一企业三角色控制台 |

切法全文：[token-hub-slices.md](token-hub-slices.md)（遵守 PRD + HLD）。手测：[TokenHub_VISION.md](TokenHub_VISION.md)。

## Feature Index

| ID | Title | Status | Priority | Category | Planned | Design |
|----|-------|--------|----------|----------|---------|--------|
| 001 | 最小双端点网关 | **Completed** | Critical | New | v0.0.1 | [设计](features/v0.0.1.md#feature_001) |
| 002 | 上游钥匙柜 | **Completed** | Critical | New | v0.0.2 | [设计](features/v0.0.2.md#feature_002) |
| 003 | 虚拟钥匙一把两端口 | **Completed** | Critical | New | v0.0.3 | [设计](features/v0.0.3.md#feature_003) |
| 004 | 同协议多渠 failover | **Completed** | Critical | New | v0.0.4 | [设计](features/v0.0.4.md#feature_004) |
| 005 | VK 绑池与分组 | **Completed** | Critical | New | v0.0.5 | [设计](features/v0.0.5.md#feature_005) |
| 006 | 限流与熔断 | **Completed** | Critical | New | v0.0.6 | [设计](features/v0.0.6.md#feature_006) |
| 007 | 预算闸与流式估算 | **Completed** | Critical | New | v0.0.7 | [设计](features/v0.0.7.md#feature_007) |
| 008 | 缓存与运营面 | **Completed** | Critical | New | v0.0.8 | [设计](features/v0.0.8.md#feature_008) |
| 009 | 独立部署收口 | **Completed** | Critical | Internal | v0.1.0 | [设计](features/v0.1.0.md#feature_009) |
| — | 0.1.0 回归补丁 | **Completed** | High | Internal | v0.1.1 | [设计](features/v0.1.1.md) |
| 010 | 单一企业三角色控制台 | **InProgress** | Critical | New | v0.1.2 | [设计](features/v0.1.2.md#feature_010) |

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

调用方只持 `fab-`；同一把 VK 走 `/v1/chat/completions` 与 `/v1/messages`；可限模型、可过期。手测：同一把 VK 调两个端点；过期或模型不在白名单被拒。

**Spec**：已综合（T1，2026-08-13 用户确认「是」）。**Tickets**：#1–#3 **Done**。

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

**Spec**：已综合（T1，2026-08-13 用户确认「是」）。**Tickets**：#1–#5 **Done**。

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

VK → Project → Team → ChannelPool → Provider Key。两把 VK 走不同池；查询层禁止跨团队渠/官方 Key。池分组 premium / standard / bulk。

**Spec**：已综合（T1，2026-08-13 用户确认「是」）。**Tickets**：#1–#3 **Done**。

### FEATURE_006: 限流与熔断

| 字段 | 内容 |
|------|------|
| ID | 006 |
| Title | 限流与熔断 |
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

Key / Provider 硬拒绝 + 突发桶；摘病路、半开、池内切流。超 RPM 立刻 429；连续失败的渠被摘掉再半开。#42 本版只先两维。Provider RPM 走官方 Key 的 `rpm_limit`。

**Spec**：已综合（T1，2026-08-13 用户确认「是」）。**Tickets**：#1–#4 **Done**。

### FEATURE_007: 预算闸与流式估算

| 字段 | 内容 |
|------|------|
| ID | 007 |
| Title | 预算闸与流式估算 |
| Status | **Completed** |
| Priority | Critical |
| Category | New |
| Planned Version | v0.0.7 |
| Released Version | v0.0.7 |
| Created | 2026-08-13 |
| Started | 2026-08-13 |
| Completed | 2026-08-13 |
| Design | [docs/features/v0.0.7.md#feature_007](features/v0.0.7.md#feature_007) |

**Description**

VK 月预算软/硬；边流边估 Token，结束用官方 usage 校准。快到额提醒，到额硬拒；长流过程中用量在涨。

**Spec**：已综合（T1，2026-08-13 用户确认「是」）。**Tickets**：#1–#4 **Done**。

### FEATURE_008: 缓存与运营面

| 字段 | 内容 |
|------|------|
| ID | 008 |
| Title | 缓存与运营面 |
| Status | **Completed** |
| Priority | Critical |
| Category | New |
| Planned Version | v0.0.8 |
| Released Version | v0.0.8 |
| Created | 2026-08-13 |
| Started | 2026-08-13 |
| Completed | 2026-08-14 |
| Design | [docs/features/v0.0.8.md#feature_008](features/v0.0.8.md#feature_008) |

**Description**

Prompt/响应缓存；VK 申请审批、IP 白名单、官方 Key 轮换。重复确定性问题可命中缓存；未审批 / 非白名单 IP 调不成。流式响应不缓存。

**Spec**：已综合（T1，2026-08-13 用户确认「是」）。**Tickets**：#1–#4 **Done**。

### FEATURE_009: 独立部署收口

| 字段 | 内容 |
|------|------|
| ID | 009 |
| Title | 独立部署收口 |
| Status | **Completed** |
| Priority | Critical |
| Category | Internal |
| Planned Version | v0.1.0 |
| Released Version | v0.1.0 |
| Created | 2026-08-14 |
| Started | 2026-08-14 |
| Completed | 2026-08-14 |
| Design | [docs/features/v0.1.0.md#feature_009](features/v0.1.0.md#feature_009) |

**Description**

Token Hub 到 0.1.0 只收口、不加新能力：镜像/compose、备份、健康、双端验收、模块文档。对照切法 6 条独立部署标准勾选。Claude Code 与 Cursor 同一把 `fab-` 走通。

**Spec**：已综合（T1 + D1，2026-08-14 用户确认「是」）。**Tickets**：#1–#3 **Done**。

### v0.1.1: 0.1.0 回归补丁

| 字段 | 内容 |
|------|------|
| ID | —（走 [KNOWN_ISSUES](KNOWN_ISSUES.md) 001–005，不占 feature 序号） |
| Title | 0.1.0 回归补丁 |
| Status | **Completed** |
| Priority | High |
| Category | Internal |
| Planned Version | v0.1.1 |
| Released Version | v0.1.1 |
| Created | 2026-08-14 |
| Started | 2026-08-14 |
| Completed | 2026-08-14 |
| Design | [docs/features/v0.1.1.md](features/v0.1.1.md) |

**Description**

v0.1.0 收口后的回归五条：XFF 白名单、镜像嵌前端、restore 不重跑 bootstrap、Redis 健康、别名与 Provider RPM 接到生产。无新 VISION 功能点。

**Spec**：按 issue 关闭记录。提交 `8ef74e0` / `f089696` / `2628606` / `3cac814` / `8849fb6`。

### FEATURE_010: 单一企业三角色控制台

| 字段 | 内容 |
|------|------|
| ID | 010 |
| Title | 单一企业三角色控制台 |
| Status | **InProgress** |
| Priority | Critical |
| Category | New |
| Planned Version | v0.1.2 |
| Released Version | — |
| Created | 2026-08-14 |
| Started | 2026-08-14 |
| Completed | — |
| Design | [docs/features/v0.1.2.md#feature_010](features/v0.1.2.md#feature_010) |

**Description**

单一企业三档角色共用现有 `/admin` 壳：企业管理员、团队管理员、开发者。按角色裁菜单和数据；开发者申请钥匙，队长批本队；官方 Key 与渠道只给企业管理员。撤掉简陋 `/app` 工作台。超管 / 多租户不做。

**Spec**：已综合（T1，2026-08-14 `/to-spec`）。**Tickets**：#1–#4 **Done**。

## Summary

| 指标 | 数量 |
|------|------|
| Total | 11 |
| Planned | 0 |
| In Progress | 1 |
| Completed | 10 |
| Critical | 10 |
