CREATE TYPE "public"."enterprise_status" AS ENUM('active', 'disabled');--> statement-breakpoint
ALTER TYPE "public"."employee_role" ADD VALUE 'org_admin';--> statement-breakpoint
CREATE TABLE "enterprises" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "enterprises_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" varchar(100) NOT NULL,
	"status" "enterprise_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "enterprises_name_uidx" ON "enterprises" USING btree ("name");--> statement-breakpoint
INSERT INTO "enterprises" ("name", "status")
SELECT '默认企业', 'active'
WHERE NOT EXISTS (SELECT 1 FROM "enterprises" LIMIT 1);--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "enterprise_id" bigint;--> statement-breakpoint
UPDATE "employees"
SET "enterprise_id" = (SELECT "id" FROM "enterprises" ORDER BY "id" ASC LIMIT 1)
WHERE "enterprise_id" IS NULL;--> statement-breakpoint
ALTER TABLE "employees" ALTER COLUMN "enterprise_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employees_enterprise_idx" ON "employees" USING btree ("enterprise_id");