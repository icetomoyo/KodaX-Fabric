ALTER TABLE "employee_api_keys" ADD COLUMN "team_id" bigint;--> statement-breakpoint
ALTER TABLE "request_audits" ADD COLUMN "team_id" bigint;--> statement-breakpoint
ALTER TABLE "employee_api_keys" ADD CONSTRAINT "employee_api_keys_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_audits" ADD CONSTRAINT "request_audits_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_api_keys_team_idx" ON "employee_api_keys" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "request_audits_team_created_idx" ON "request_audits" USING btree ("team_id","created_at");