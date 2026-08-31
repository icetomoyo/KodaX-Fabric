# Changelog

<!-- last-sync: 42ea5d2 -->

## [Unreleased]

### Added

- 超管后台「Key 绑定」：在上游渠道和模型单价之间用关系图画企业 → 团队 → 员工 → 虚拟 Key → 智谱 Key；按近 7 日单日峰值把员工标为轻度 / 标准 / 重度（新用户默认标准）

### Changed

- 智谱渠道模型单价与员工模型列表只展示当前生效的 `glm-5.3`（文本）和 `glm-5.3-flash`（多模态）；Key 测试带回的历史模型名归并到这两条
- 智谱转发白名单仅允许 `glm-5.3` / `glm-5.3-flash`，其它模型名直接 403 `model not allowed`
- 调度策略重构为分档绑定（重度独占 / 标准团队共享 / 轻度企业共享），渠道 Key 支持 5 小时与周积分额度（按智谱积分计量；系数在模型单价页配置；内置 GLM 官方默认系数，可在模型单价页覆盖；高峰工作日 14:00–18:00 乘数 1、非高峰 0.5），耗尽自动冷却换绑
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
- 注册审核、部署与接入相关能力
