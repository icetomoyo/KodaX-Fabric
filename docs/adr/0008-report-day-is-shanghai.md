# 报表的「日」按 Asia/Shanghai 切

用量按 Project × Model × 日聚合。Request 存 UTC，归日用 Asia/Shanghai。

第一批流量、成本和管理员都在这个时区。用 UTC 日会对不齐「每天花了多少」；按 Project 配时区是多租户才有的问题。
