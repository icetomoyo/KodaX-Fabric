ALTER TABLE "enterprises" ADD COLUMN "parent_id" bigint;--> statement-breakpoint
ALTER TABLE "enterprises" ADD COLUMN "dingtalk_dept_id" bigint;--> statement-breakpoint
ALTER TABLE "enterprises" ADD CONSTRAINT "enterprises_parent_id_enterprises_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."enterprises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enterprises_parent_idx" ON "enterprises" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enterprises_dingtalk_dept_id_uidx" ON "enterprises" USING btree ("dingtalk_dept_id") WHERE "dingtalk_dept_id" is not null;--> statement-breakpoint
UPDATE "enterprises"
SET "name" = '海致集团', "dingtalk_dept_id" = 1
WHERE "name" = '默认企业'
  AND NOT EXISTS (SELECT 1 FROM "enterprises" WHERE "name" = '海致集团');--> statement-breakpoint
UPDATE "enterprises" SET "dingtalk_dept_id" = 1 WHERE "name" = '海致集团' AND "dingtalk_dept_id" IS NULL;--> statement-breakpoint
UPDATE "enterprises" AS child
SET
  "parent_id" = parent.id,
  "dingtalk_dept_id" = CASE child.name
    WHEN '海致科技' THEN 855501967
    WHEN '海致星图' THEN 139656157
    ELSE child.dingtalk_dept_id
  END
FROM "enterprises" AS parent
WHERE parent.name = '海致集团'
  AND child.name IN ('海致科技', '海致星图');
