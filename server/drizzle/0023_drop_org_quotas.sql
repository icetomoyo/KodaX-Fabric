ALTER TABLE "enterprises" DROP COLUMN IF EXISTS "package_plan";--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN IF EXISTS "monthly_yuan_quota";--> statement-breakpoint
ALTER TABLE "team_members" DROP COLUMN IF EXISTS "daily_token_limit";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."enterprise_package";
