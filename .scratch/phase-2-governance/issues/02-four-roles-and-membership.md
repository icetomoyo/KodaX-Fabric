# 02 — 四角色、成员、企业控制台人事

**What to build:** User 恰好一个角色。超级管理员创建企业管理员。企业管理员创建 Team、团队管理员、开发者并派进 Team。团队管理员本 Team 加/撤开发者。一人可加入多个 Team。三套控制台按角色放行，越权 403。

**Blocked by:** 01 — 企业、Team 成本桶、超级管理员

**Status:** resolved

- [x] 超级管理员可创建企业管理员；企业管理员看不见其他企业
- [x] 企业管理员可创建 Team（不改名不删）以及团队管理员/开发者并加入 Team
- [x] 团队管理员可在本 Team 加/撤开发者，不能造团队管理员
- [x] 撤成员后立刻看不见该 Team；已发 VK 仍能调用
- [x] 开发者打平台/企业 API、企业管理员打平台线路 API → 403

## Answer

User 恰好一个角色。`POST /admin/api/users`：超级管理员创建 `enterprise_admin`；企业管理员创建 `team_admin` / `developer`（企业取自己的）。`POST/DELETE /admin/api/teams/{name}/members` 管成员。企业管理员 `GET /admin/api/enterprises` 只见本企业；`GET /admin/api/projects` 按角色过滤。撤成员后列表立刻不含该 Team，VK 仍能打网关。开发者打企业/线路、企业管理员打 Provider/Model/价格 → 403。

Context: `internal/fabric/roles_test.go`.
