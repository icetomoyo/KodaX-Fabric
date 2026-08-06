CREATE TYPE "public"."api_key_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."audit_status" AS ENUM('success', 'upstream_error', 'client_error', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."body_storage" AS ENUM('db', 'object');--> statement-breakpoint
CREATE TYPE "public"."credential_status" AS ENUM('active', 'disabled', 'auto_disabled', 'cooling');--> statement-breakpoint
CREATE TYPE "public"."employee_role" AS ENUM('employee', 'admin');--> statement-breakpoint
CREATE TYPE "public"."employee_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."product_type" AS ENUM('api', 'coding_plan');--> statement-breakpoint
CREATE TYPE "public"."relay_protocol" AS ENUM('openai_chat', 'openai_responses', 'anthropic_messages');--> statement-breakpoint
CREATE TYPE "public"."share_mode" AS ENUM('public_pool', 'grant_only', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."usage_source" AS ENUM('upstream', 'estimated', 'none');--> statement-breakpoint
CREATE TABLE "credential_employee_grants" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "credential_employee_grants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"credential_id" bigint NOT NULL,
	"employee_id" bigint NOT NULL,
	"granted_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_api_keys" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "employee_api_keys_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"employee_id" bigint NOT NULL,
	"name" varchar(100) NOT NULL,
	"key_prefix" varchar(32) NOT NULL,
	"key_hash" varchar(128) NOT NULL,
	"key_encrypted" text NOT NULL,
	"protocol" "relay_protocol" NOT NULL,
	"product_line_id" bigint NOT NULL,
	"status" "api_key_status" DEFAULT 'active' NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "employees_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" varchar(100) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"password_hash" text NOT NULL,
	"dept" varchar(100),
	"role" "employee_role" DEFAULT 'employee' NOT NULL,
	"status" "employee_status" DEFAULT 'active' NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"password_changed_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_routes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "model_routes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"client_model" varchar(128) NOT NULL,
	"product_line_id" bigint NOT NULL,
	"upstream_model" varchar(128) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"weight" integer DEFAULT 100 NOT NULL,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_audit_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ops_audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_employee_id" bigint,
	"action" varchar(100) NOT NULL,
	"target_type" varchar(64),
	"target_id" varchar(64),
	"detail" jsonb,
	"ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "product_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"provider_id" bigint NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"product_type" "product_type" NOT NULL,
	"base_url_override" text,
	"protocol_configs" jsonb,
	"config_version" integer DEFAULT 1 NOT NULL,
	"share_mode" "share_mode" DEFAULT 'public_pool' NOT NULL,
	"allow_auto_route" boolean DEFAULT true NOT NULL,
	"retry_policy" jsonb,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "providers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"default_base_url" text NOT NULL,
	"auth_style" varchar(32) DEFAULT 'bearer' NOT NULL,
	"openai_compat_level" varchar(32) DEFAULT 'full' NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quota_policy" (
	"key" varchar(32) PRIMARY KEY DEFAULT 'default' NOT NULL,
	"daily_token_limit" bigint DEFAULT 500000000 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_audit_bodies" (
	"request_id" varchar(64) PRIMARY KEY NOT NULL,
	"request_headers" jsonb,
	"request_body" jsonb,
	"response_body" jsonb,
	"request_body_size" integer,
	"response_body_size" integer,
	"storage" "body_storage" DEFAULT 'db' NOT NULL,
	"object_key" text,
	"truncated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_audits" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "request_audits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"request_id" varchar(64) NOT NULL,
	"employee_id" bigint NOT NULL,
	"employee_api_key_id" bigint,
	"protocol" "relay_protocol" DEFAULT 'openai_chat' NOT NULL,
	"client_model" varchar(128) NOT NULL,
	"upstream_model" varchar(128),
	"provider_code" varchar(64),
	"product_line_id" bigint,
	"product_type" "product_type",
	"credential_id" bigint,
	"credential_suffix" varchar(8),
	"is_stream" boolean DEFAULT false NOT NULL,
	"status" "audit_status" NOT NULL,
	"http_status" integer,
	"upstream_status" integer,
	"error_code" varchar(64),
	"error_message" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"total_tokens" integer,
	"usage_source" "usage_source" DEFAULT 'none',
	"usage_raw" jsonb,
	"latency_ms" integer,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"retry_trace" jsonb,
	"client_ip" varchar(64),
	"user_agent" text,
	"request_path" varchar(256),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" varchar(128) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upstream_credentials" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "upstream_credentials_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"product_line_id" bigint NOT NULL,
	"label" varchar(200) NOT NULL,
	"secret_encrypted" text NOT NULL,
	"secret_suffix" varchar(8) NOT NULL,
	"supported_protocols" "relay_protocol"[] DEFAULT '{"openai_chat"}' NOT NULL,
	"weight" integer DEFAULT 100 NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" "credential_status" DEFAULT 'active' NOT NULL,
	"cool_until" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"success_count" bigint DEFAULT 0 NOT NULL,
	"error_count" bigint DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_counters_daily" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "usage_counters_daily_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"day" date NOT NULL,
	"employee_id" bigint NOT NULL,
	"prompt_tokens" bigint DEFAULT 0 NOT NULL,
	"completion_tokens" bigint DEFAULT 0 NOT NULL,
	"total_tokens" bigint DEFAULT 0 NOT NULL,
	"request_count" bigint DEFAULT 0 NOT NULL,
	"error_count" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credential_employee_grants" ADD CONSTRAINT "credential_employee_grants_credential_id_upstream_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."upstream_credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_employee_grants" ADD CONSTRAINT "credential_employee_grants_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_api_keys" ADD CONSTRAINT "employee_api_keys_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_api_keys" ADD CONSTRAINT "employee_api_keys_product_line_id_product_lines_id_fk" FOREIGN KEY ("product_line_id") REFERENCES "public"."product_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_routes" ADD CONSTRAINT "model_routes_product_line_id_product_lines_id_fk" FOREIGN KEY ("product_line_id") REFERENCES "public"."product_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_lines" ADD CONSTRAINT "product_lines_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_audits" ADD CONSTRAINT "request_audits_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upstream_credentials" ADD CONSTRAINT "upstream_credentials_product_line_id_product_lines_id_fk" FOREIGN KEY ("product_line_id") REFERENCES "public"."product_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters_daily" ADD CONSTRAINT "usage_counters_daily_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credential_employee_grants_uidx" ON "credential_employee_grants" USING btree ("credential_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_api_keys_hash_uidx" ON "employee_api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "employee_api_keys_employee_idx" ON "employee_api_keys" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employee_api_keys_product_line_idx" ON "employee_api_keys" USING btree ("product_line_id");--> statement-breakpoint
CREATE INDEX "employee_api_keys_employee_product_line_idx" ON "employee_api_keys" USING btree ("employee_id","product_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_phone_uidx" ON "employees" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "model_routes_client_idx" ON "model_routes" USING btree ("client_model","enabled");--> statement-breakpoint
CREATE INDEX "ops_audit_logs_created_idx" ON "ops_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_lines_provider_code_uidx" ON "product_lines" USING btree ("provider_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "providers_code_uidx" ON "providers" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "request_audits_request_id_uidx" ON "request_audits" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_audits_employee_created_idx" ON "request_audits" USING btree ("employee_id","created_at");--> statement-breakpoint
CREATE INDEX "request_audits_created_idx" ON "request_audits" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "upstream_credentials_pl_idx" ON "upstream_credentials" USING btree ("product_line_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_counters_daily_uidx" ON "usage_counters_daily" USING btree ("day","employee_id");--> statement-breakpoint
CREATE INDEX "usage_counters_daily_employee_day_idx" ON "usage_counters_daily" USING btree ("employee_id","day");