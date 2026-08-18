---
status: superseded by ADR-0024
---

# Project 只来自 Virtual Key

一次调用记到哪个 Project，只看这把 VK 绑定的 Project。`x-fabric-context` 里的 `project_id` 不能覆盖。没带或与 VK 一致则通过；带了但不一致则拒绝。

若允许 header 改项目，一把 VK 就能把账记到任意成本桶，计量验收失效。

P2 起成本桶是 Team，见 ADR-0024。header 里的 `project_id` 仍不能改桶。
