CREATE INDEX "usage_counters_daily_employee_day_idx" ON "usage_counters_daily" USING btree ("employee_id","day");--> statement-breakpoint
INSERT INTO "quota_policies" (
  "name",
  "soft_tpm_day",
  "hard_tpm_day",
  "rpm",
  "max_concurrency",
  "soft_req_day",
  "hard_req_day",
  "is_default"
)
SELECT '默认日 Token 配额', NULL, 500000000, 60, 5, NULL, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM "quota_policies" WHERE "is_default" = true);--> statement-breakpoint
WITH selected_default AS (
  SELECT "id"
  FROM "quota_policies"
  WHERE "is_default" = true
  ORDER BY "id"
  LIMIT 1
)
UPDATE "quota_policies"
SET "is_default" = false,
    "updated_at" = now()
WHERE "is_default" = true
  AND "id" <> (SELECT "id" FROM selected_default);--> statement-breakpoint
UPDATE "quota_policies"
SET "hard_tpm_day" = coalesce("hard_tpm_day", 500000000),
    "soft_tpm_day" = NULL,
    "soft_req_day" = NULL,
    "hard_req_day" = NULL,
    "updated_at" = now()
WHERE "is_default" = true;
