DROP INDEX "team_members_employee_idx";--> statement-breakpoint
DELETE FROM "team_members"
WHERE "id" IN (
	SELECT "id" FROM (
		SELECT
			"id",
			ROW_NUMBER() OVER (
				PARTITION BY "employee_id"
				ORDER BY
					CASE WHEN "role" = 'team_admin' THEN 0 ELSE 1 END,
					"created_at" ASC,
					"id" ASC
			) AS "rn"
		FROM "team_members"
	) AS "ranked"
	WHERE "rn" > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_employee_uidx" ON "team_members" USING btree ("employee_id");
