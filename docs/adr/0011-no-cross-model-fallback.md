# 禁止跨 model Fallback，也不改请求体

PRD §4 写过同协议内 `gpt-4` → `gpt-4o`。那必须改请求体里的 `model`，和零转换透传冲突：调用方点名的模型和实际上游、价格、账本对不齐，也会改变 prompt cache 等按 model 生效的语义。

P2 不改写请求/响应体。Failover 只在同一 wire model 的 Channel 之间换上游凭据和地址。`gpt-4` 要落到 `gpt-4o`，调用方自己传 `gpt-4o`。
