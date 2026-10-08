DROP INDEX IF EXISTS "employees_dingtalk_userid_uidx";--> statement-breakpoint
CREATE INDEX "employees_dingtalk_userid_idx" ON "employees" USING btree ("dingtalk_userid");
