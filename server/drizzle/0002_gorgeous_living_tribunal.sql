CREATE TYPE "public"."relay_protocol" AS ENUM('openai_chat', 'openai_responses', 'anthropic_messages');--> statement-breakpoint
ALTER TABLE "employee_api_keys" ADD COLUMN "protocol" "relay_protocol" DEFAULT 'openai_chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "request_audits" ADD COLUMN "protocol" "relay_protocol" DEFAULT 'openai_chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "upstream_credentials" ADD COLUMN "supported_protocols" "relay_protocol"[] DEFAULT '{"openai_chat"}' NOT NULL;