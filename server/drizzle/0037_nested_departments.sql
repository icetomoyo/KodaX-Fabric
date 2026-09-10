ALTER TABLE "departments" ADD COLUMN "parent_id" bigint;
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_departments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX "departments_parent_idx" ON "departments" USING btree ("parent_id");

DROP INDEX IF EXISTS "departments_enterprise_name_uidx";
CREATE UNIQUE INDEX "departments_enterprise_parent_name_uidx" ON "departments" ("enterprise_id", (COALESCE("parent_id", 0)), "name");

CREATE TEMP TABLE "named_team_dept_map" AS
SELECT
  t."id" AS "team_id",
  t."department_id" AS "old_department_id",
  t."enterprise_id",
  t."name",
  t."status",
  t."created_at",
  t."updated_at"
FROM "teams" t
WHERE t."is_default" = false;

INSERT INTO "departments" ("enterprise_id", "parent_id", "name", "status", "is_default", "created_at", "updated_at")
SELECT "enterprise_id", "old_department_id", "name", "status", false, "created_at", "updated_at"
FROM "named_team_dept_map";

UPDATE "teams" AS t
SET
  "department_id" = d."id",
  "is_default" = true,
  "updated_at" = now()
FROM "named_team_dept_map" AS m
INNER JOIN "departments" AS d
  ON d."enterprise_id" = m."enterprise_id"
  AND d."parent_id" = m."old_department_id"
  AND d."name" = m."name"
WHERE t."id" = m."team_id";

UPDATE "employees"
SET "role" = 'dept_admin', "updated_at" = now()
WHERE "role" = 'team_admin';

UPDATE "team_members"
SET "role" = 'member'
WHERE "role" = 'team_admin';
