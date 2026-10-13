ALTER TABLE "upstream_credentials" ADD COLUMN "five_hour_window_base_credits" numeric(14, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_lines" ADD COLUMN "weekly_window_reset_at" timestamp with time zone;--> statement-breakpoint
-- 智谱团队套餐的周限额重置时刻（控制台所示，Asia/Shanghai）。同一套餐下的 Key 共用；
-- 只填还没有设置的套餐，之后在「编辑模式」里维护。
UPDATE "product_lines" AS pl
SET "weekly_window_reset_at" = v.reset_at, "updated_at" = now()
FROM "providers" AS p,
  (VALUES
    ('GLM-50', '2026-10-14 23:59:00+08'::timestamptz),
    ('GLM-30', '2026-10-13 15:36:00+08'::timestamptz),
    ('GLM-10', '2026-10-19 15:49:00+08'::timestamptz)
  ) AS v(name, reset_at)
WHERE pl.provider_id = p.id
  AND p.code = 'glm'
  AND pl.product_type = 'coding_plan'
  AND pl.name = v.name
  AND pl.weekly_window_reset_at IS NULL;
--> statement-breakpoint
-- 以上面录入的套餐时间为准：这三个套餐下各 Key 之前从上游回包学到的周重置时刻
-- 与套餐时间不一致，清掉后统一跟随套餐。之后某把 Key 再撞到周限额，仍会按回包重新学。
UPDATE "upstream_credentials" AS uc
SET "weekly_window_reset_at" = NULL, "updated_at" = now()
FROM "product_lines" AS pl, "providers" AS p
WHERE uc.product_line_id = pl.id
  AND pl.provider_id = p.id
  AND p.code = 'glm'
  AND pl.product_type = 'coding_plan'
  AND pl.name IN ('GLM-50', 'GLM-30', 'GLM-10')
  AND uc.weekly_window_reset_at IS NOT NULL;
