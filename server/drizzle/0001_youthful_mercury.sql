ALTER TABLE "product_lines" ADD COLUMN "protocol_configs" jsonb;--> statement-breakpoint
ALTER TABLE "product_lines" ADD COLUMN "config_version" integer DEFAULT 1 NOT NULL;