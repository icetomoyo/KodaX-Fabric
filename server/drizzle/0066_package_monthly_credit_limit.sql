ALTER TABLE "product_lines" ADD COLUMN "monthly_credit_limit" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "product_lines" ADD COLUMN "monthly_window_reset_at" timestamp with time zone;
