# Changelog

<!-- last-sync: 42ea5d2 -->

## [Unreleased]

### Changed

- 工程与 npm 包主体名称统一为 **KodaX-Fabric**（`kodax-fabric` / `@kodax-fabric/*`）；Token Hub 作为核心模块名保留

---

## [0.1.0] - 2026-08-11

Fabric · **Token Hub** 公司内可大范围公测收口版（FEATURE_001）。

### Added

- 公测章程与配置基线（渠道、账号、配额 5 亿/人/日、对接人、安全）
- 发布 / 备份恢复 runbook，以及值班故障排查一页纸
- E10 回归清单与实跑记录（含 Claude Code / Cursor 双端验证）
- 员工接入教程强化：双协议对照、Cursor 专节、「一客户端一把 Key」
- 功能与问题追踪：`FEATURE_LIST`、`KNOWN_ISSUES`、收尾说明 `v0.1.0-closeout.md`

### Fixed

- `channel-overview` 默认单测在无 `.env` 时因配置加载失败的问题

### Documentation

- 部署 README 与公测/运维文档互链
- 产品叙事统一为 KodaX Fabric 核心模块 Token Hub

### Notes

- 工程版本号与 monorepo `package.json` 对齐为 **0.1.0**
- 生产 Docker 镜像 tag 仍可能带 `0.0.5-…` 构建后缀，以主机 `compose.yaml` 为准；换镜像时请单独发版镜像
- 已知后续优化：日 Token 触顶时客户端 Retry 文案不友好（KNOWN_ISSUES 001）

---

## [0.0.5] - 2026-08-07

### Added

- 基础工单（员工提交/自查，管理员查询）
- 注册审核、部署与接入相关能力（详见 `docs/token-hub/history/v0.0.5.md` / TokenHub_PRD）
