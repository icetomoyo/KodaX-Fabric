# P1 只开两个端点

网关只暴露 `POST /v1/chat/completions` 和 `POST /v1/messages`。embeddings、images、completions、Responses API 都不开。

透传范围和计量范围必须同一批。多开却不上账，或上账却没有透传契约，都会让账对不齐。
