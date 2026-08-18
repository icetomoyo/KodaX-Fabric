# Provider、Provider Key、Channel 分开

P1 把密钥焊在 Provider 行上：一个名字 = 一个 base URL = 一把钥匙。同模型多 Key 会逼出 `openai-backup` 这种假厂商。

Provider 是厂商：协议家族 + base URL（换地址就是另一个上游）。Provider Key 属于一个 Provider，可以进入多个 Model 的池。Channel 是 (Model, Provider Key) + 权重 + 优先级；同一对只能有一条。

拒绝让 Channel 自己带着密钥和地址——那样 Provider Key 从模型里消失，凭据和下一路由参数会糊成一团。
