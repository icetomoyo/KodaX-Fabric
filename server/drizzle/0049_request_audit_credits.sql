ALTER TABLE "request_audits" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "request_audits" ADD COLUMN "request_credits" numeric(14, 4);
