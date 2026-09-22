CREATE INDEX "team_members_employee_team_idx" ON "team_members" USING btree ("employee_id","team_id");
