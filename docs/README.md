# docs 怎么看

Token Hub 按 [fabric/PRD.md](fabric/PRD.md) §3 **从 0 重开**。  
`main` 上那四篇是原始设计；公司内试点文档已整夹归档，不当实现依据。

```text
docs/
├── README.md
├── FEATURE_LIST.md        新基线（现为空，待登记 0.0.x）
├── KNOWN_ISSUES.md        新基线（现为空）
├── features/              feature-manager 约定目录（现空）
├── fabric/                原始愿景（来自 main）
│   ├── PRD.md / HLD.md / UI_DESIGN.md
│   ├── TokenHub_VISION.md     §3 功能表 + 人话版
│   └── archive/ProductDraft.md
└── archive/tokenhub-pilot/    2026 公司内试点（硬绑定模型）
```

## 先读什么

1. [fabric/PRD.md](fabric/PRD.md) §3 — Token Hub 愿景（原始）
2. [fabric/TokenHub_VISION.md](fabric/TokenHub_VISION.md) — 57 点功能表 + 人话版
3. [FEATURE_LIST.md](FEATURE_LIST.md) — 新切片进度（尚未登记）

谈整机再看 [fabric/HLD.md](fabric/HLD.md)、[fabric/UI_DESIGN.md](fabric/UI_DESIGN.md)。  
不要从 [fabric/archive/ProductDraft.md](fabric/archive/ProductDraft.md) 入门。

## 现网试点（考古 / 值班）

`https://tokenhub.haizhi.com` 若仍在服务，发布和排障看：

- [archive/tokenhub-pilot/runbook-release.md](archive/tokenhub-pilot/runbook-release.md)
- [archive/tokenhub-pilot/runbook-troubleshoot.md](archive/tokenhub-pilot/runbook-troubleshoot.md)
- [archive/tokenhub-pilot/README.md](archive/tokenhub-pilot/README.md)

那些文档描述的是旧模型（Key 硬绑渠道 + 协议），不是新 Token Hub。
