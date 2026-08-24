CREATE TABLE "usage_counters_team_daily" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "usage_counters_team_daily_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"day" date NOT NULL,
	"team_id" bigint NOT NULL,
	"employee_id" bigint NOT NULL,
	"prompt_tokens" bigint DEFAULT 0 NOT NULL,
	"completion_tokens" bigint DEFAULT 0 NOT NULL,
	"total_tokens" bigint DEFAULT 0 NOT NULL,
	"request_count" bigint DEFAULT 0 NOT NULL,
	"error_count" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "daily_token_limit" bigint;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "daily_token_quota" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_counters_team_daily" ADD CONSTRAINT "usage_counters_team_daily_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters_team_daily" ADD CONSTRAINT "usage_counters_team_daily_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_counters_team_daily_uidx" ON "usage_counters_team_daily" USING btree ("day","team_id","employee_id");--> statement-breakpoint
CREATE INDEX "usage_counters_team_daily_team_day_idx" ON "usage_counters_team_daily" USING btree ("team_id","day");--> statement-breakpoint
CREATE INDEX "usage_counters_team_daily_employee_day_idx" ON "usage_counters_team_daily" USING btree ("employee_id","day");