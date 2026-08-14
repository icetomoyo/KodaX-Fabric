# Claude Skills 清单

本机路径：`~/.claude/skills/`  
上游仓库：[icetomoyo/CodingSkills](https://github.com/icetomoyo/CodingSkills)（v0.5.0，16 个）

本机这 16 个 skill 与 CodingSkills 清单一一对应。`implement`、`diagnosing-bugs`、`domain-modeling` 由 CodingSkills 改编自 [mattpocock/skills](https://github.com/mattpocock/skills)。

| Skill | 调用 | 用途 | 来源 |
|-------|------|------|------|
| `which-skill` | 用户 `/which-skill` | CodingSkills 导航。不知道用哪个时，描述场景即可 | [CodingSkills](https://github.com/icetomoyo/CodingSkills/tree/main/skills/which-skill) |
| `feature-manager` | 模型 | 管 FEATURE_LIST.md + feature 生命周期（Add → 指向构建链 → Complete） | [CodingSkills](https://github.com/icetomoyo/CodingSkills/tree/main/skills/feature-manager) |
| `issue-manager` | 模型 | 管 KNOWN_ISSUES.md + issue 生命周期（Add → 指向修复链 → Resolve） | [CodingSkills](https://github.com/icetomoyo/CodingSkills/tree/main/skills/issue-manager) |
| `grilling` | 模型 | 质询原语：一次一问，附推荐答案，事实自查、决策才问人 | [CodingSkills](https://github.com/icetomoyo/CodingSkills/tree/main/skills/grilling) |
| `grill-me` | 用户 `/grill-me` | 脱离流程的一轮质询，薄委托 `grilling` | [CodingSkills](https://github.com/icetomoyo/CodingSkills/tree/main/skills/grill-me) |
| `to-spec` | 用户 `/to-spec` | 对话 + 代码库综合成 spec，写入设计块 Part B | [CodingSkills](https://github.com/icetomoyo/CodingSkills/tree/main/skills/to-spec) |
| `to-tickets` | 用户 `/to-tickets` | spec 拆成 tracer-bullet 垂直切片票（DAG），写入实现步骤 | [CodingSkills](https://github.com/icetomoyo/CodingSkills/tree/main/skills/to-tickets) |
| `implement` | 用户 `/implement` | 按票构建：tdd → code-review → 提交 | [CodingSkills](https://github.com/icetomoyo/CodingSkills/tree/main/skills/implement)（改编自 [mattpocock/skills](https://github.com/mattpocock/skills)） |
| `tdd` | 模型 | 测试先行：预先确认 seam，red → green，重构不在循环内 | [CodingSkills](https://github.com/icetomoyo/CodingSkills/tree/main/skills/tdd) |
| `code-review` | 模型 | 双轴评审：Standards（规范+坏味道）+ Spec（是否忠实需求） | [CodingSkills](https://github.com/icetomoyo/CodingSkills/tree/main/skills/code-review) |
| `diagnosing-bugs` | 模型 | 难 bug 诊断：先建能红的反馈循环，再假设、探针、修 | [CodingSkills](https://github.com/icetomoyo/CodingSkills/tree/main/skills/diagnosing-bugs)（改编自 [mattpocock/skills](https://github.com/mattpocock/skills)） |
| `domain-modeling` | 模型 | 磨领域术语，写 CONTEXT.md / ADR | [CodingSkills](https://github.com/icetomoyo/CodingSkills/tree/main/skills/domain-modeling)（改编自 [mattpocock/skills](https://github.com/mattpocock/skills)） |
| `human-test-guide` | 用户 `/human-test-guide` | 为功能或 issue 修复生成人工测试 / 回归指导 | [CodingSkills](https://github.com/icetomoyo/CodingSkills/tree/main/skills/human-test-guide) |
| `smart-release` | 用户 `/smart-release` | 从 git 提交同步 CHANGELOG.md，可选版本 bump 与发布 | [CodingSkills](https://github.com/icetomoyo/CodingSkills/tree/main/skills/smart-release) |
| `handoff` | 用户 `/handoff` | 把当前对话压成交接文档，换会话接着干 | [CodingSkills](https://github.com/icetomoyo/CodingSkills/tree/main/skills/handoff) |
| `writing-great-skills` | 用户 `/writing-great-skills` | 写 / 审计 skill 的方法论 | [CodingSkills](https://github.com/icetomoyo/CodingSkills/tree/main/skills/writing-great-skills) |

用法说明见同目录 [README.md](./README.md)。
