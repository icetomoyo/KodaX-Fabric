CREATE TYPE "public"."org_unit_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."team_member_role" AS ENUM('member', 'team_admin');--> statement-breakpoint
ALTER TYPE "public"."employee_role" ADD VALUE 'team_admin';--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "project_members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"project_id" bigint NOT NULL,
	"employee_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "projects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"team_id" bigint NOT NULL,
	"name" varchar(100) NOT NULL,
	"status" "org_unit_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "team_members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"team_id" bigint NOT NULL,
	"employee_id" bigint NOT NULL,
	"role" "team_member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "teams_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"enterprise_id" bigint NOT NULL,
	"name" varchar(100) NOT NULL,
	"status" "org_unit_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_enterprise_id_enterprises_id_fk" FOREIGN KEY ("enterprise_id") REFERENCES "public"."enterprises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_project_employee_uidx" ON "project_members" USING btree ("project_id","employee_id");--> statement-breakpoint
CREATE INDEX "project_members_employee_idx" ON "project_members" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_team_name_uidx" ON "projects" USING btree ("team_id","name");--> statement-breakpoint
CREATE INDEX "projects_team_idx" ON "projects" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_team_employee_uidx" ON "team_members" USING btree ("team_id","employee_id");--> statement-breakpoint
CREATE INDEX "team_members_employee_idx" ON "team_members" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_enterprise_name_uidx" ON "teams" USING btree ("enterprise_id","name");--> statement-breakpoint
CREATE INDEX "teams_enterprise_idx" ON "teams" USING btree ("enterprise_id");