-- 潮汐调度：被授权的员工用一把潮汐KEY，在开放时段内把请求铺到闲置的渠道 Key 上。
CREATE TYPE "public"."api_key_mode" AS ENUM('bound', 'tidal');--> statement-breakpoint
ALTER TABLE "employee_api_keys" ADD COLUMN "mode" "api_key_mode" DEFAULT 'bound' NOT NULL;--> statement-breakpoint
-- 一个员工最多一把潮汐KEY。
CREATE UNIQUE INDEX "employee_api_keys_tidal_employee_uidx" ON "employee_api_keys" USING btree ("employee_id") WHERE "mode" = 'tidal';--> statement-breakpoint
CREATE TABLE "tidal_grants" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tidal_grants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"employee_id" bigint NOT NULL,
	"max_concurrency" integer NOT NULL,
	"rpm_limit" integer NOT NULL,
	"expires_at" timestamp with time zone,
	"note" varchar(200),
	"granted_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "tidal_grants" ADD CONSTRAINT "tidal_grants_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tidal_grants_employee_uidx" ON "tidal_grants" USING btree ("employee_id");--> statement-breakpoint
-- 潮汐请求打上标记，日志里能认出来；用量统计和普通请求一样照常计入。
ALTER TABLE "request_audits" ADD COLUMN "tidal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "request_audits_tidal_created_idx" ON "request_audits" USING btree ("created_at") WHERE "tidal";
