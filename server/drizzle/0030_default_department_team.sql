ALTER TABLE "departments" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "departments" SET "is_default" = true WHERE "name" = '默认部门';
--> statement-breakpoint
INSERT INTO "teams" ("enterprise_id", "department_id", "name", "status", "is_default")
SELECT d."enterprise_id", d."id", '默认团队', 'active', true
FROM "departments" AS d
WHERE NOT EXISTS (
  SELECT 1 FROM "teams" AS t
  WHERE t."department_id" = d."id" AND (t."is_default" = true OR t."name" = '默认团队')
);
--> statement-breakpoint
UPDATE "teams" SET "is_default" = true WHERE "name" = '默认团队';
--> statement-breakpoint
CREATE UNIQUE INDEX "departments_enterprise_default_uidx" ON "departments" USING btree ("enterprise_id") WHERE "is_default";
--> statement-breakpoint
CREATE UNIQUE INDEX "teams_department_default_uidx" ON "teams" USING btree ("department_id") WHERE "is_default";
