ALTER TABLE "request_audits" ADD COLUMN "cache_read_tokens" integer;--> statement-breakpoint
UPDATE "request_audits" SET "cache_read_tokens" = COALESCE(
  ("usage_raw"->>'cache_read_input_tokens')::int,
  ("usage_raw"->'prompt_tokens_details'->>'cached_tokens')::int,
  ("usage_raw"->'input_tokens_details'->>'cached_tokens')::int
);--> statement-breakpoint
ALTER TABLE "request_audits" DROP COLUMN "protocol";--> statement-breakpoint
ALTER TABLE "request_audits" DROP COLUMN "upstream_model";--> statement-breakpoint
ALTER TABLE "request_audits" DROP COLUMN "credential_suffix";--> statement-breakpoint
ALTER TABLE "request_audits" DROP COLUMN "is_stream";--> statement-breakpoint
ALTER TABLE "request_audits" DROP COLUMN "http_status";--> statement-breakpoint
ALTER TABLE "request_audits" DROP COLUMN "upstream_status";--> statement-breakpoint
ALTER TABLE "request_audits" DROP COLUMN "error_code";--> statement-breakpoint
ALTER TABLE "request_audits" DROP COLUMN "error_message";--> statement-breakpoint
ALTER TABLE "request_audits" DROP COLUMN "usage_source";--> statement-breakpoint
ALTER TABLE "request_audits" DROP COLUMN "usage_raw";--> statement-breakpoint
ALTER TABLE "request_audits" DROP COLUMN "latency_ms";--> statement-breakpoint
ALTER TABLE "request_audits" DROP COLUMN "retry_count";--> statement-breakpoint
ALTER TABLE "request_audits" DROP COLUMN "retry_trace";--> statement-breakpoint
ALTER TABLE "request_audits" DROP COLUMN "ttft_ms";--> statement-breakpoint
ALTER TABLE "request_audits" DROP COLUMN "generation_ms";--> statement-breakpoint
ALTER TABLE "request_audits" DROP COLUMN "client_ip";--> statement-breakpoint
ALTER TABLE "request_audits" DROP COLUMN "user_agent";--> statement-breakpoint
ALTER TABLE "request_audits" DROP COLUMN "request_path";--> statement-breakpoint
DROP TABLE "request_audit_bodies";--> statement-breakpoint
DROP TYPE "public"."usage_source";--> statement-breakpoint
DROP TYPE "public"."body_storage";
