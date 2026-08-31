ALTER TABLE "model_prices" ADD COLUMN "prompt_credits_per_10k" numeric(10, 4);--> statement-breakpoint
ALTER TABLE "model_prices" ADD COLUMN "cache_hit_credits_per_10k" numeric(10, 4);--> statement-breakpoint
ALTER TABLE "model_prices" ADD COLUMN "completion_credits_per_10k" numeric(10, 4);--> statement-breakpoint
ALTER TABLE "credential_usage_hourly" ADD COLUMN "total_credits" numeric(14, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "upstream_credentials" ADD COLUMN "five_hour_credit_limit" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "upstream_credentials" ADD COLUMN "weekly_credit_limit" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "upstream_credentials" DROP COLUMN "five_hour_token_limit";--> statement-breakpoint
ALTER TABLE "upstream_credentials" DROP COLUMN "weekly_token_limit";
