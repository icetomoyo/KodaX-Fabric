CREATE TABLE "sensitive_word_hits" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sensitive_word_hits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"request_id" varchar(64) NOT NULL,
	"employee_id" bigint NOT NULL,
	"employee_api_key_id" bigint,
	"team_id" bigint,
	"client_model" varchar(128) NOT NULL,
	"protocol" "relay_protocol" NOT NULL,
	"path" varchar(256) NOT NULL,
	"matched_word" varchar(64) NOT NULL,
	"excerpt" text,
	"request_preview" jsonb,
	"user_agent" varchar(512),
	"ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sensitive_word_hits" ADD CONSTRAINT "sensitive_word_hits_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensitive_word_hits" ADD CONSTRAINT "sensitive_word_hits_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sensitive_word_hits_request_id_uidx" ON "sensitive_word_hits" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "sensitive_word_hits_created_idx" ON "sensitive_word_hits" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sensitive_word_hits_employee_created_idx" ON "sensitive_word_hits" USING btree ("employee_id","created_at");
