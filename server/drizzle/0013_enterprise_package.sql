CREATE TYPE "public"."enterprise_package" AS ENUM('plus', 'pro', 'max');
--> statement-breakpoint
ALTER TABLE "enterprises" ADD COLUMN "package_plan" "enterprise_package";
--> statement-breakpoint
ALTER TABLE "enterprises" DROP COLUMN "daily_token_quota";
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "monthly_yuan_quota" numeric(12, 2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN "daily_token_quota";
--> statement-breakpoint
