# Changelog

## [Unreleased]

---

## [0.0.4] - 2026-08-13

KodaX-Fabric。落地模块仍是 Token Hub。

### Added

- 同协议多渠 failover：priority 主备、同级加权轮转、5xx/429/网络错误换路、4xx 不换
- 同协议模型别名 fallback（只改发出去的 `model`）
- 路由审计头：`X-Fabric-Request-Id` / `X-Fabric-Route` / `X-Fabric-Fallback`

---

## [0.0.3] - 2026-08-13

KodaX-Fabric 首次按切法发布。当前落地模块是 Token Hub（Go 单进程网关）。

### Added

- Token Hub 双端点零转换网关：`POST /v1/chat/completions`、`POST /v1/messages`，SSE 透传
- 上游钥匙柜：官方 Key 加密入库、同协议轮转、401/403 停用
- 虚拟钥匙一把两端口：同一把 `fab-` 走两个端点；`expires_at` 到期 401；`model_scope` 不在名单或缺 model 时 403
- 管理控制台：登录、用户管理、上游钥匙 / 池 / 渠 / VK 编目

### Fixed

- 控制台 TypeScript 路径配置，去掉已弃用的 `baseUrl`

<!-- last-sync: 2c5c722 -->
