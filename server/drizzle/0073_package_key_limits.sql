ALTER TABLE "product_lines" ADD COLUMN IF NOT EXISTS "key_max_members" integer;--> statement-breakpoint
ALTER TABLE "product_lines" ADD COLUMN IF NOT EXISTS "key_max_concurrency" integer;
