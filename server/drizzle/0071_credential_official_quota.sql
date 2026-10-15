-- Snapshot of the official (vendor-side) quota, written only by a manual refresh.
ALTER TABLE "upstream_credentials" ADD COLUMN IF NOT EXISTS "official_quota" jsonb;
--> statement-breakpoint
ALTER TABLE "upstream_credentials" ADD COLUMN IF NOT EXISTS "official_quota_at" timestamp with time zone;
