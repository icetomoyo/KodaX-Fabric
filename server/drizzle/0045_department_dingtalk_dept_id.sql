ALTER TABLE "departments" ADD COLUMN "dingtalk_dept_id" bigint;
--> statement-breakpoint
CREATE UNIQUE INDEX "departments_dingtalk_dept_id_uidx" ON "departments" USING btree ("dingtalk_dept_id") WHERE "dingtalk_dept_id" IS NOT NULL;
