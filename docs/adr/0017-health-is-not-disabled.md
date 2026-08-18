# 熔断和管理员停用是两根开关

P1 的 `disabled` 是单向管理员位。若熔断共用它，探测会把管理员手停的 Channel 重新打开，或管理员无法按住一条烂路径。

`disabled` 只属于管理员，VK / Model / Provider / Provider Key / Channel 都可停可开。Health（closed / open / half-open）是另一根，参数全局统一，进程内保存，重启即 closed。熔断从不改管理员位。半开只放行 1 个 in-flight 探测（真实入口），其余仍视作 open，不排队、不另打合成请求。

一次 Attempt 算成功 ⇔ 它不会触发 failover（400 算成功，429/502 算失败）。按 HTTP 2xx 算会让调用方自己的 400 把好 Channel 按在 open 上。默认窗口：最近 100 次、< 80% 打开、open 满 30s 半开。
