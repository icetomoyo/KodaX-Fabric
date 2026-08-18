# 01 — 企业、Team 成本桶、超级管理员

**What to build:** 隔离边界是企业；成本桶从 P1 Project 改名为 Team。种子超级管理员能创建/停用企业。VK 绑 Team。调用记到 Team。`team_id` 核对、`project_id` 拒绝。报表按 Team × Model × 日。P1 透传套件在改名后仍绿。

**Blocked by:** None — can start immediately.

**Status:** claimed

- [x] 超级管理员登录后可创建企业；创建后不能改名、不能删除；可停用
- [x] 种子企业下有种子 Team `demo`；VK 绑 Team；Request 与用量按 Team 聚合
- [x] `x-fabric-context.team_id` 缺省或一致则过；不一致拒绝且不打上游
- [x] 出现 `project_id` → 拒绝且不打上游
- [x] P1 非流式/流式透传、错误 VK、未登记 model 仍从 HTTP 缝通过

P1 `/admin/api/projects` 仍可用（Team 的过渡名）。停用企业后该企业下 VK 立刻 403。`GET /admin/api/me` 的 role 为 `super_admin`。
