# 05 — Project 绑定与 x-fabric-context

**What to build:** Virtual Key 绑死一个不可改名、不可删的 Project。一次调用记到哪个 Project 只看这把 VK。`x-fabric-context` 里的 `project_id` 只能核对、不能改账；`run_id` 只认显式值；`task_type` 原样记下。

**Blocked by:** 04 — Virtual Key 创建与停用

**Status:** ready-for-agent

- [ ] 管理员可创建 Project；创建后不能改名、不能删除
- [ ] 创建 VK 时必须绑到一个 Project；该调用的 Request.Project 等于 VK 的绑定，不听 header 改记
- [ ] 未传 `project_id` 或与绑定一致 → 调用成功；不一致或头畸形 → 拒绝且不打到 Provider
- [ ] 显式 `run_id` 出现在 Request 上；不传则 Run 为空，不做时间窗口推断
- [ ] `task_type` 原样出现在 Request 上，不影响路由
