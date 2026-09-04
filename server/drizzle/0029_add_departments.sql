CREATE TABLE "departments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "departments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"enterprise_id" bigint NOT NULL,
	"name" varchar(100) NOT NULL,
	"status" "org_unit_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "departments_enterprise_name_uidx" ON "departments" USING btree ("enterprise_id","name");
--> statement-breakpoint
CREATE INDEX "departments_enterprise_idx" ON "departments" USING btree ("enterprise_id");
--> statement-breakpoint
INSERT INTO "departments" ("enterprise_id", "name", "status")
SELECT "id", '默认部门', 'active' FROM "enterprises";
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "department_id" bigint;
--> statement-breakpoint
UPDATE "teams" AS t
SET "department_id" = d."id"
FROM "departments" AS d
WHERE d."enterprise_id" = t."enterprise_id" AND d."name" = '默认部门';
--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "department_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
DROP INDEX IF EXISTS "teams_enterprise_name_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX "teams_department_name_uidx" ON "teams" USING btree ("department_id","name");
--> statement-breakpoint
CREATE INDEX "teams_department_idx" ON "teams" USING btree ("department_id");
