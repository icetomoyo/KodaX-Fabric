ALTER TABLE "upstream_credentials" ADD COLUMN "five_hour_window_anchor" timestamptz;
--> statement-breakpoint
ALTER TABLE "upstream_credentials" ADD COLUMN "weekly_window_reset_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "upstream_credentials" ADD COLUMN "last_failure_kind" varchar(32);
--> statement-breakpoint
ALTER TABLE "upstream_credentials" ADD COLUMN "last_vendor_code" varchar(16);
--> statement-breakpoint
-- 周窗口相位从 meta.learnedCapReset 一等化为列（智谱 429 报文学到的下一次翻转时刻）。
UPDATE "upstream_credentials"
SET "weekly_window_reset_at" = ("meta"->'learnedCapReset'->>'weekly')::timestamptz
WHERE "meta"->'learnedCapReset'->>'weekly' IS NOT NULL;
--> statement-breakpoint
-- 存量失败归类：厂商码优先，其次按 last_error 关键词，冷却/停用中的行优先补齐。
UPDATE "upstream_credentials" AS u
SET "last_vendor_code" = m.code,
    "last_failure_kind" = m.kind
FROM (
  SELECT "id",
    (regexp_match("last_error", '\[(\d{3,4})\]'))[1] AS code,
    CASE
      WHEN "last_error" ~ '\[(1310|1317|1319|1321)\]' OR "last_error" ~* '7\s*[- ]?天|周积分|每周|7\s*[- ]?days?' THEN 'weekly_cap'
      WHEN "last_error" ~ '\[(1308|1316|1318|1320)\]' OR "last_error" ~* '5\s*[- ]?小时|5\s*[- ]?hours?' THEN 'five_hour_cap'
      WHEN "last_error" ~* '上游限流|速率限制|请求过于频繁|并发请求数已达上限|访问量过大|rate.?limit' THEN 'rate_limit'
      WHEN "last_error" ~* '余额不足|欠费|套餐已到期|套餐已失效|套餐暂未开放|使用上限' THEN 'other'
      WHEN "status" = 'auto_disabled' OR "last_error" ~ 'HTTP 40[13]' THEN 'auth'
      ELSE 'other'
    END AS kind
  FROM "upstream_credentials"
  WHERE "last_error" IS NOT NULL
) AS m
WHERE u."id" = m."id" AND u."last_failure_kind" IS NULL;
