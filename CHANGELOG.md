# Changelog

## [Unreleased]

---

## [0.0.8] - 2026-08-14

KodaX-Fabric。落地模块仍是 Token Hub。

### Added

- 确定性非流响应缓存：请求标明可缓存时，相同协议 + 模型 + 规范化请求体第二次命中，`X-Fabric-Cache: hit`，不打上游；`stream:true` 永不缓存
- VK 申请审批：`POST /console/v1/vk-requests` 申请无明文；管理员批准后明文只亮一次；`pending` 不能调 `/v1`
- VK 可选 IP 白名单：不在名单 403；空名单不拦
- 停用旧官方 Key 后，同一把 `fab-` 打到池内新钥

---

## [0.0.7] - 2026-08-13

KodaX-Fabric。落地模块仍是 Token Hub。

### Added

- VK 本月 Token 预算：软 80% 提醒仍放行，硬 100% 返回 402 `budget_exceeded`
- 长流 SSE 注释显示用量递增；结束以厂家 `usage` 校准入账
- 管理后台团队项目页：左侧选团队，右侧只看该队项目

---

## [0.0.6] - 2026-08-13

KodaX-Fabric。落地模块仍是 Token Hub。

### Added

- VK / Provider 两维令牌桶：超 RPM 硬拒绝 429，允许约 1.2 倍突发
- 渠熔断：连续失败摘病路、冷却后半开探测，流量留在同池健康渠
- 控制台：团队 / 项目编目，池与官方 Key 可绑团队，VK 可绑项目，路由审计页
- 控制台品牌改为 KodaX-Fabric

### Changed

- 管理后台与开发者工作台样式整理

---

## [0.0.5] - 2026-08-13

KodaX-Fabric。落地模块仍是 Token Hub。

### Added

- VK 绑项目/团队/池：两把 `fab-` 走不同池，互不串线
- 查询层团队隔离：错挂的跨团队官方 Key 不会被选中；伪造 team/pool 头无效；无归属 VK 打不到有团队的 Key
- 池分组 `premium` / `standard` / `bulk` 写入 `X-Fabric-Pool-Group` 与路由审计

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

<!-- last-sync: 50ab05f -->
