DROP TABLE IF EXISTS "project_members";--> statement-breakpoint
DROP TABLE IF EXISTS "projects";--> statement-breakpoint
UPDATE "employees" SET "usage_tier" = 'standard' WHERE "usage_tier" = 'light';--> statement-breakpoint
DELETE FROM "credential_bindings" WHERE "scope_type" = 'enterprise';--> statement-breakpoint
ALTER TABLE "employees" ALTER COLUMN "usage_tier" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "public"."usage_tier" RENAME TO "usage_tier_old";--> statement-breakpoint
CREATE TYPE "public"."usage_tier" AS ENUM('idle', 'standard', 'heavy');--> statement-breakpoint
ALTER TABLE "employees" ALTER COLUMN "usage_tier" TYPE "public"."usage_tier" USING "usage_tier"::text::"public"."usage_tier";--> statement-breakpoint
DROP TYPE "public"."usage_tier_old";--> statement-breakpoint
ALTER TABLE "employees" ALTER COLUMN "usage_tier" SET DEFAULT 'heavy';
