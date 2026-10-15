ALTER TABLE "product_lines" ADD COLUMN IF NOT EXISTS "official_quota_query_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "product_lines"
SET "official_quota_query_enabled" = true
WHERE trim(coalesce("zhipu_organization_id", '')) <> ''
  AND trim(coalesce("zhipu_project_id", '')) <> '';
