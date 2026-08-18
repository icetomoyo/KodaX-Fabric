# Provider 和 Channel 是平台一套，不属于企业

集团下属公司共用同一份上游合同；按企业各建一套线路会把同一把 Key 拆成多份，也让 `model` 在不同企业里指向不同池。

P2 只有一套 Provider / Provider Key / Channel / 价格，由超级管理员配置。企业之间的隔离在账、User、VK、预算，不在线路。企业管理员看不见密钥。企业自带 Key、以及同一 `model` 混平台池与企业池，另开决策。
