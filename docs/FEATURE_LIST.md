# FEATURE_LIST

Last Updated: 2026-08-13 11:00

## Version Info

| 项 | 值 |
|----|-----|
| Current Release | **v0.0.1** |
| Planned Version | **v0.0.2** |

## Version Summary

| 版本 | 状态 | 进度 | 说明 |
|------|------|------|------|
| v0.0.1 | Released | 1/1 | 最小双端点网关 |
| v0.0.2 | **In Progress** | 0/1 | 上游钥匙柜 |
| v0.0.3 | — | — | 虚拟钥匙，一把两端口 |
| v0.0.4 | — | — | 渠道池 + 简单路由 |
| v0.0.5 | — | — | VK 绑池 + 分组 |
| v0.0.6 | — | — | 限流 + 熔断 |
| v0.0.7 | — | — | 预算闸 + 流式估算 |
| v0.0.8 | — | — | 缓存 + 运营面 |
| v0.1.0 | — | — | 独立部署收口 |

切法全文：[token-hub-slices.md](token-hub-slices.md)（遵守 PRD + HLD）。手测：[TokenHub_VISION.md](TokenHub_VISION.md)。

## Feature Index

| ID | Title | Status | Priority | Category | Planned | Design |
|----|-------|--------|----------|----------|---------|--------|
| 001 | 最小双端点网关 | **Completed** | Critical | New | v0.0.1 | [设计](features/v0.0.1.md#feature_001) |
| 002 | 上游钥匙柜 | **InProgress** | Critical | New | v0.0.2 | [设计](features/v0.0.2.md#feature_002) |

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
| Status | **InProgress** |
| Priority | Critical |
| Category | New |
| Planned Version | v0.0.2 |
| Released Version | — |
| Created | 2026-08-13 |
| Started | 2026-08-13 |
| Completed | — |
| Design | [docs/features/v0.0.2.md#feature_002](features/v0.0.2.md#feature_002) |

**Description**

管理员把官方 Key 加密存进网关；同一家可以挂多把并轮转；401 / 额度用尽的 Key 能停用，不再被选。手测：两把 Key 打流会摊，废 Key 不再打。

**Spec**：进行中。**Tickets**：未拆。

## Summary

| 指标 | 数量 |
|------|------|
| Total | 2 |
| Planned | 0 |
| In Progress | 1 |
| Completed | 1 |
| Critical | 2 |
