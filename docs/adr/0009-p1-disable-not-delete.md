# 只停用，不删

VK、Model、Provider、Provider Key、Channel、User、Team、企业 都不能物理删除。P2 起（除企业/Team 名以外的开关）可以再启用。停用 Provider 则其下所有 Key 的 Channel 不入选；停用 Key 则它从所有池里拿掉；停用 Model 则该字符串整池不接；停用 Channel 只从这一个 Model 的池里拿掉。去掉 Channel 的价格行等于这条路径不能入选。企业和 Team 不能删、不能改名——名字是隔离边界和报表主键。

删配置会留下指着空气的 Request（以及 Request 上的 Attempt 快照）；改 Team 名会让「Team × 日」对不上历史账。Request 本来就不可改、不可删。
