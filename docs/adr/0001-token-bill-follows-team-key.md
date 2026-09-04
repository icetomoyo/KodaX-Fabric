# Token 账单跟团队 Key 走，不跟项目走

PRD 把 Virtual Key 绑死项目做成本归因。实际里员工会跨多个项目，一把 Key 看不出「这次调用属于哪个项目」，按项目发 Key 也不现实。账单粒度是团队：员工在所属团队有 Key，用量记入该 Key 所属团队。用 A 团队的 Key 去做 B 团队的工作，当作使用问题，系统不拦截。部门只做组织容器，不记账。项目级归因不改 Key，见 [ADR 0002](./0002-project-usage-via-kodax-header.md)。
