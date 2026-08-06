CREATE TABLE "quota_policy" (
	"key" varchar(32) PRIMARY KEY DEFAULT 'default' NOT NULL,
	"daily_token_limit" bigint DEFAULT 500000000 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "quota_policy" ("key", "daily_token_limit")
SELECT 'default', coalesce("hard_tpm_day", 500000000)
FROM "quota_policies"
WHERE "is_default" = true
ORDER BY "id"
LIMIT 1;--> statement-breakpoint
INSERT INTO "quota_policy" ("key", "daily_token_limit")
VALUES ('default', 500000000)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
DROP TABLE "employee_quota_overrides" CASCADE;--> statement-breakpoint
DROP TABLE "quota_policies" CASCADE;--> statement-breakpoint
ALTER TABLE "log_access_grants" DROP COLUMN "can_read_body";--> statement-breakpoint
ALTER TABLE "usage_counters_daily" DROP COLUMN "soft_limit_hit";
