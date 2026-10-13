-- 潮汐申请：员工说明要用到什么时候，超级管理员审核通过后按这个时间写入 tidal_grants。
CREATE TYPE "public"."tidal_application_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "tidal_applications" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tidal_applications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"employee_id" bigint NOT NULL,
	"requested_expires_at" timestamp with time zone NOT NULL,
	"reason" varchar(200),
	"status" "tidal_application_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" bigint,
	"reviewed_at" timestamp with time zone,
	"review_note" varchar(200),
	"max_concurrency" integer,
	"rpm_limit" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "tidal_applications" ADD CONSTRAINT "tidal_applications_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- 一个人同时只能有一条待审核的申请。
CREATE UNIQUE INDEX "tidal_applications_pending_employee_uidx" ON "tidal_applications" USING btree ("employee_id") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "tidal_applications_status_created_idx" ON "tidal_applications" USING btree ("status","created_at");
