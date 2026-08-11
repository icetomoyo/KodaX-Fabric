# FEATURE_LIST

Last Updated: 2026-08-11 16:15

## Version Info

| 项 | 值 |
|----|-----|
| Current Release | v0.0.5 |
| Planned Version | v0.1.0 |

## Version Summary

| 版本 | 状态 | 进度 | 说明 |
|------|------|------|------|
| v0.0.5 | Released（基线） | — | Token Hub 切片已内网可用，同事可用 Key + Claude Code |
| v0.1.0 | In Progress | 0/1 Completed，1 In Progress | Fabric 核心模块 Token Hub 达到公司内可大范围公测 |

## Feature Index

| ID | Title | Status | Priority | Category | Planned | Design |
|----|-------|--------|----------|----------|---------|--------|
| 001 | Token Hub 核心模块公测收口 | InProgress | Critical | Enhancement | v0.1.0 | [设计](features/v0.1.0.md#feature_001) |

## Feature Details

### FEATURE_001: Token Hub 核心模块公测收口

| 字段 | 内容 |
|------|------|
| ID | 001 |
| Title | Token Hub 核心模块公测收口 |
| Status | InProgress |
| Priority | Critical |
| Category | Enhancement |
| Planned Version | v0.1.0 |
| Released Version | — |
| Created | 2026-08-11 |
| Started | 2026-08-11 |
| Completed | — |
| Design | [docs/features/v0.1.0.md#feature_001](features/v0.1.0.md#feature_001) |

**Description**

将 KodaX Fabric 的核心模块 Token Hub（当前工程实现 / 历史名 TokenHub）从 v0.0.5「E1～E10 均为部分满足」收到 **公司内可大范围公测** 的 v0.1.0 完成态。以公测准入与现网补洞为主（M5 + L4），不纳入 ROI、组织层级、Commerce、SSO 等非本模块能力。

**第一刀（已对齐）**：S1 公测章程 + 配置基线成文；其后默认 S2 发布/备份 → S3 接入自助 → S4 故障怎么查；仅修复挡住公测的代码 P0。

**构建状态**：已 Start。**Ticket #1 Done**（`docs/pilot-charter.md`）。下一前沿：#2 / #3 / #4（可并行）→ 然后 #5。

## Summary

| 指标 | 数量 |
|------|------|
| Total | 1 |
| Planned | 0 |
| In Progress | 1 |
| Completed | 0 |
| Critical | 1 |
| High | 0 |
| Medium | 0 |
| Low | 0 |

Next Release (v0.1.0): 1 feature (1 in progress, 0 completed, 0 planned)
Highest Priority InProgress: 001 (Token Hub 核心模块公测收口)
