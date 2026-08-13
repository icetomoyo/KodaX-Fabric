# FEATURE_LIST

Last Updated: 2026-08-13 10:50

## Version Info

| 项 | 值 |
|----|-----|
| Current Release | **v0.0.1** |
| Planned Version | — |

## Version Summary

| 版本 | 状态 | 进度 | 说明 |
|------|------|------|------|
| v0.0.1 | Released | 1/1 | 最小双端点网关 |
| v0.0.2 | — | — | 上游钥匙柜（切法已冻，完成后登记） |
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

## Summary

| 指标 | 数量 |
|------|------|
| Total | 1 |
| Planned | 0 |
| In Progress | 0 |
| Completed | 1 |
| Critical | 1 |
