CREATE TABLE "request_error_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "request_error_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"request_id" varchar(64) NOT NULL,
	"employee_id" bigint NOT NULL,
	"team_id" bigint,
	"client_model" varchar(128) NOT NULL,
	"provider_code" varchar(64),
	"product_line_id" bigint,
	"product_type" "product_type",
	"credential_id" bigint,
	"status" "audit_status" NOT NULL,
	"http_status" integer,
	"upstream_status" integer,
	"error_code" varchar(64),
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "request_error_logs" ADD CONSTRAINT "request_error_logs_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_error_logs" ADD CONSTRAINT "request_error_logs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "request_error_logs_request_id_uidx" ON "request_error_logs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_error_logs_created_idx" ON "request_error_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "request_error_logs_team_created_idx" ON "request_error_logs" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "request_error_logs_code_created_idx" ON "request_error_logs" USING btree ("error_code","created_at");
