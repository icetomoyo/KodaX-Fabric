CREATE TABLE "static_files" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "static_files_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"sha256" varchar(64) NOT NULL,
	"kind" varchar(8) NOT NULL,
	"bytes" bigint NOT NULL,
	"media_type" varchar(128),
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_request_id" varchar(96)
);--> statement-breakpoint
CREATE TABLE "static_file_owners" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "static_file_owners_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"file_id" bigint NOT NULL,
	"employee_id" bigint NOT NULL,
	"team_id" bigint,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "static_file_owners" ADD CONSTRAINT "static_file_owners_file_id_static_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."static_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "static_file_owners" ADD CONSTRAINT "static_file_owners_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "static_file_owners" ADD CONSTRAINT "static_file_owners_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "static_files_sha256_uidx" ON "static_files" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "static_files_first_seen_idx" ON "static_files" USING btree ("first_seen_at");--> statement-breakpoint
CREATE INDEX "static_files_bytes_idx" ON "static_files" USING btree ("bytes");--> statement-breakpoint
CREATE UNIQUE INDEX "static_file_owners_file_employee_uidx" ON "static_file_owners" USING btree ("file_id","employee_id");--> statement-breakpoint
CREATE INDEX "static_file_owners_employee_idx" ON "static_file_owners" USING btree ("employee_id");
