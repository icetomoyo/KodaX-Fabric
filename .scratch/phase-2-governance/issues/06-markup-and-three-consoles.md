# 06 — 对客倍率与三套控制台

**What to build:** 超级管理员设全局倍率。Request 写入当时对客金额。平台控制台看成本/对客/毛利。企业与团队控制台只看成本。三套路由互不混登。P1 `/admin` 种子超管进平台控制台。

**Blocked by:** 02 — 四角色、成员、企业控制台人事；05 — 熔断、限流、预算

**Status:** resolved

- [x] 改倍率后新 Request 用新倍率；旧 Request 对客金额不变
- [x] 平台控制台能下钻企业/Team 看见毛利；企业/团队控制台 JSON 无对客字段
- [x] `/platform`、`/enterprise`、`/team` 按角色进入；混登 403
- [x] 企业控制台无线路/密钥入口；团队控制台按角色藏「加开发者」
- [x] 调用方可在响应头看到 Request id 与预算/限流剩余

## Answer

`PUT /admin/api/markup` 写全局倍率；Request.customer_cny 按当时倍率 × cost 一次写入。`/platform/api` 仅超级管理员，用量含对客/毛利与 Attempt；`/enterprise/api` 与 `/team/api` 按角色放行，JSON 无对客字段。P1 `/admin` 进对应控制台。调用方响应头：`X-Fabric-Request-Id`、`X-Fabric-RateLimit-Remaining`、`X-Fabric-Budget-Remaining`。

Context: `internal/fabric/console_test.go`, `web/src/lib/consoles.ts`.
