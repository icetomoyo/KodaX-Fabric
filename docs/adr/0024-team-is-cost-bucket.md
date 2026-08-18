# Fabric 的成本桶是 Team，不是 Project

P1 把成本桶叫 Project。KodaX Space 的 Project 是本地工作目录，不是成本桶。两个词同名。没有 Space 时账只能算到团队；Space 项目级归因要等以后通信，P2 不做。

成本桶改名为 Team。VK 绑定 Team。一次调用记到哪个 Team，只看 VK，`x-fabric-context` 不能改桶。报表是企业 → Team × Model × 日。P1 的 `projects` 就是这种桶，改名，不在上面再叠一层 Fabric Project。Space 项目 P2 不创建、不绑 VK、不进报表主键。
