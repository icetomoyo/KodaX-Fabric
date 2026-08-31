CREATE TYPE "public"."binding_scope_type" AS ENUM('employee', 'team', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."usage_tier" AS ENUM('light', 'standard', 'heavy');--> statement-breakpoint
CREATE TABLE "credential_bindings" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "credential_bindings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"credential_id" bigint NOT NULL,
	"product_line_id" bigint NOT NULL,
	"scope_type" "binding_scope_type" NOT NULL,
	"scope_id" bigint NOT NULL,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credential_usage_hourly" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "credential_usage_hourly_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"credential_id" bigint NOT NULL,
	"hour_start" timestamp with time zone NOT NULL,
	"total_tokens" bigint DEFAULT 0 NOT NULL,
	"request_count" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "usage_tier" "usage_tier" DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "upstream_credentials" ADD COLUMN "five_hour_token_limit" bigint;--> statement-breakpoint
ALTER TABLE "upstream_credentials" ADD COLUMN "weekly_token_limit" bigint;--> statement-breakpoint
ALTER TABLE "credential_bindings" ADD CONSTRAINT "credential_bindings_credential_id_upstream_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."upstream_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_bindings" ADD CONSTRAINT "credential_bindings_product_line_id_product_lines_id_fk" FOREIGN KEY ("product_line_id") REFERENCES "public"."product_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_usage_hourly" ADD CONSTRAINT "credential_usage_hourly_credential_id_upstream_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."upstream_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credential_bindings_credential_id_uidx" ON "credential_bindings" USING btree ("credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_bindings_product_line_scope_uidx" ON "credential_bindings" USING btree ("product_line_id","scope_type","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_usage_hourly_credential_hour_uidx" ON "credential_usage_hourly" USING btree ("credential_id","hour_start");