# FEATURE_LIST

Last Updated: 2026-08-13 10:00

## Version Info

| 项 | 值 |
|----|-----|
| Current Release | **v0.1.0** |
| Planned Version | — |

## Version Summary

| 版本 | 状态 | 进度 | 说明 |
|------|------|------|------|
| v0.0.1 | Released | 1/1 | 最小双端点网关 |
| v0.0.2 | Released | 1/1 | 上游钥匙柜（随 0.1.0 收口落地，文档事后回填） |
| v0.0.3 | Released | 1/1 | 虚拟钥匙，一把两端口 |
| v0.0.4 | Released | 1/1 | 渠道池 + 同协议 failover |
| v0.0.5 | Released | 1/1 | VK 绑池 + 分组 |
| v0.0.6 | Released | 1/1 | 限流 + 熔断硬拒绝 |
| v0.0.7 | Released | 1/1 | VK 月 Token 硬闸 |
| v0.0.8 | Released | 1/1 | 申请审批 / IP / 吊销（缓存与自动轮换未做） |
| v0.1.0 | Released | 1/1 | 独立部署收口 |

切法全文：[token-hub-slices.md](token-hub-slices.md)（遵守 PRD + HLD）。手测：[TokenHub_VISION.md](TokenHub_VISION.md)。

> 002–009 于 2026-08-13 按 feature-manager 设计块格式**事后回填**。代码已在 0.1.0 收口落地，未逐版重跑 `/to-spec` 访谈闸、`/to-tickets` 批准闸、`/implement`。缺口写在各版 Out of Scope。

## Feature Index

| ID | Title | Status | Priority | Category | Planned | Design |
|----|-------|--------|----------|----------|---------|--------|
| 001 | 最小双端点网关 | **Completed** | Critical | New | v0.0.1 | [设计](features/v0.0.1.md#feature_001) |
| 002 | 上游钥匙柜 | **Completed** | Critical | New | v0.0.2 | [设计](features/v0.0.2.md#feature_002) |
| 003 | 虚拟钥匙一把两端口 | **Completed** | Critical | New | v0.0.3 | [设计](features/v0.0.3.md#feature_003) |
| 004 | 同协议多渠 failover | **Completed** | Critical | New | v0.0.4 | [设计](features/v0.0.4.md#feature_004) |
| 005 | VK 绑池与分组 | **Completed** | Critical | New | v0.0.5 | [设计](features/v0.0.5.md#feature_005) |
| 006 | RPM 硬拒绝与渠熔断 | **Completed** | Critical | New | v0.0.6 | [设计](features/v0.0.6.md#feature_006) |
| 007 | VK 月 Token 硬预算 | **Completed** | High | New | v0.0.7 | [设计](features/v0.0.7.md#feature_007) |
| 008 | 申请审批、一次性 reveal、IP 白名单 | **Completed** | High | New | v0.0.8 | [设计](features/v0.0.8.md#feature_008) |
| 009 | 0.1.0 独立部署收口 | **Completed** | Critical | Internal | v0.1.0 | [设计](features/v0.1.0.md#feature_009) |

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

**Spec**：已综合（T1）。**Tickets**：#1–#4 **Done**。

### FEATURE_002: 上游钥匙柜

| 字段 | 内容 |
|------|------|
| ID | 002 |
| Title | 上游钥匙柜 |
| Status | **Completed** |
| Priority | Critical |
| Category | New |
| Planned Version | v0.0.2 |
| Released Version | v0.1.0 |
| Created | 2026-08-13 |
| Started | 2026-08-13 |
| Completed | 2026-08-13 |
| Design | [docs/features/v0.0.2.md#feature_002](features/v0.0.2.md#feature_002) |

**Description**

官方 Key AES-GCM 入库；同一 Provider 多把 Key；人手停用后不再被选。不自动轮换、不因 401 自动摘除。

### FEATURE_003: 虚拟钥匙一把两端口

| 字段 | 内容 |
|------|------|
| ID | 003 |
| Title | 虚拟钥匙一把两端口 |
| Status | **Completed** |
| Priority | Critical |
| Category | New |
| Planned Version | v0.0.3 |
| Released Version | v0.1.0 |
| Created | 2026-08-13 |
| Started | 2026-08-13 |
| Completed | 2026-08-13 |
| Design | [docs/features/v0.0.3.md#feature_003](features/v0.0.3.md#feature_003) |

**Description**

调用方只持 `fab-`；同一把 VK 走两个 `/v1` 端点；可限模型、可过期。

### FEATURE_004: 同协议多渠 failover

| 字段 | 内容 |
|------|------|
| ID | 004 |
| Title | 同协议多渠 failover |
| Status | **Completed** |
| Priority | Critical |
| Category | New |
| Planned Version | v0.0.4 |
| Released Version | v0.1.0 |
| Created | 2026-08-13 |
| Started | 2026-08-13 |
| Completed | 2026-08-13 |
| Design | [docs/features/v0.0.4.md#feature_004](features/v0.0.4.md#feature_004) |

**Description**

同协议多渠按优先级/权重排序；5xx 换路，4xx 不换。无加权抽签、无改模型名、无路由审计表。

### FEATURE_005: VK 绑池与分组

| 字段 | 内容 |
|------|------|
| ID | 005 |
| Title | VK 绑池与分组 |
| Status | **Completed** |
| Priority | Critical |
| Category | New |
| Planned Version | v0.0.5 |
| Released Version | v0.1.0 |
| Created | 2026-08-13 |
| Started | 2026-08-13 |
| Completed | 2026-08-13 |
| Design | [docs/features/v0.0.5.md#feature_005](features/v0.0.5.md#feature_005) |

**Description**

VK 必绑渠道池；池有 premium/standard/bulk。无 Project/Team 树，隔离靠不同池。

### FEATURE_006: RPM 硬拒绝与渠熔断

| 字段 | 内容 |
|------|------|
| ID | 006 |
| Title | RPM 硬拒绝与渠熔断 |
| Status | **Completed** |
| Priority | Critical |
| Category | New |
| Planned Version | v0.0.6 |
| Released Version | v0.1.0 |
| Created | 2026-08-13 |
| Started | 2026-08-13 |
| Completed | 2026-08-13 |
| Design | [docs/features/v0.0.6.md#feature_006](features/v0.0.6.md#feature_006) |

**Description**

VK RPM 超限 429；渠连续失败熔断 15s，全开路 503。进程内计数，非 Redis 四维限流。

### FEATURE_007: VK 月 Token 硬预算

| 字段 | 内容 |
|------|------|
| ID | 007 |
| Title | VK 月 Token 硬预算 |
| Status | **Completed** |
| Priority | High |
| Category | New |
| Planned Version | v0.0.7 |
| Released Version | v0.1.0 |
| Created | 2026-08-13 |
| Started | 2026-08-13 |
| Completed | 2026-08-13 |
| Design | [docs/features/v0.0.7.md#feature_007](features/v0.0.7.md#feature_007) |

**Description**

月 Token 到额 402。非流式用厂家 usage 累加。无软闸、无边流边估。

### FEATURE_008: 申请审批、一次性 reveal、IP 白名单

| 字段 | 内容 |
|------|------|
| ID | 008 |
| Title | 申请审批、一次性 reveal、IP 白名单 |
| Status | **Completed** |
| Priority | High |
| Category | New |
| Planned Version | v0.0.8 |
| Released Version | v0.1.0 |
| Created | 2026-08-13 |
| Started | 2026-08-13 |
| Completed | 2026-08-13 |
| Design | [docs/features/v0.0.8.md#feature_008](features/v0.0.8.md#feature_008) |

**Description**

开发者申请、管理员批准、明文只 reveal 一次；IP 白名单；吊销。响应缓存与官方 Key 自动轮换未做。

### FEATURE_009: 0.1.0 独立部署收口

| 字段 | 内容 |
|------|------|
| ID | 009 |
| Title | 0.1.0 独立部署收口 |
| Status | **Completed** |
| Priority | Critical |
| Category | Internal |
| Planned Version | v0.1.0 |
| Released Version | v0.1.0 |
| Created | 2026-08-13 |
| Started | 2026-08-13 |
| Completed | 2026-08-13 |
| Design | [docs/features/v0.1.0.md#feature_009](features/v0.1.0.md#feature_009) |

**Description**

compose + 备份回滚 + `/health` + 同进程操作台。无新功能点。git tag `v0.1.0` 已存在，未再跑 smart-release。

## Summary

| 指标 | 数量 |
|------|------|
| Total | 9 |
| Planned | 0 |
| In Progress | 0 |
| Completed | 9 |
| Critical | 7 |
| High | 2 |
