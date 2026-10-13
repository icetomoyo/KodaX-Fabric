ALTER TABLE "product_lines" ADD COLUMN "five_hour_credit_limit" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "product_lines" ADD COLUMN "weekly_credit_limit" numeric(14, 4);--> statement-breakpoint
-- 积分上限改为只在套餐上设置，渠道 Key 不再单独设置。
-- 套餐的上限取该套餐下已设置的 Key 里最常见的那组数值（数量相同时取较小的一组）。
UPDATE "product_lines" AS pl
SET "five_hour_credit_limit" = top.five_hour,
    "weekly_credit_limit" = top.weekly,
    "updated_at" = now()
FROM (
  SELECT DISTINCT ON (grouped.product_line_id)
         grouped.product_line_id,
         grouped.five_hour,
         grouped.weekly
  FROM (
    SELECT product_line_id,
           five_hour_credit_limit AS five_hour,
           weekly_credit_limit AS weekly,
           count(*) AS key_count
    FROM "upstream_credentials"
    WHERE five_hour_credit_limit IS NOT NULL OR weekly_credit_limit IS NOT NULL
    GROUP BY product_line_id, five_hour_credit_limit, weekly_credit_limit
  ) AS grouped
  ORDER BY grouped.product_line_id,
           grouped.key_count DESC,
           grouped.five_hour ASC NULLS LAST,
           grouped.weekly ASC NULLS LAST
) AS top
WHERE pl.id = top.product_line_id;--> statement-breakpoint
ALTER TABLE "upstream_credentials" DROP COLUMN "five_hour_credit_limit";--> statement-breakpoint
ALTER TABLE "upstream_credentials" DROP COLUMN "weekly_credit_limit";
