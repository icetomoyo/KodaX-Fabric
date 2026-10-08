ALTER TABLE "employees" ADD COLUMN "dingtalk_userid" varchar(64);--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "job_number" varchar(64);--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "work_place" varchar(100);--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "dingtalk_remark" varchar(500);--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "manager_userid" varchar(64);--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "dingtalk_dept_ids" jsonb;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "dept_order_list" jsonb;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "leader_in_dept" jsonb;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "role_list" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "employees_dingtalk_userid_uidx" ON "employees" USING btree ("dingtalk_userid") WHERE "dingtalk_userid" is not null;
