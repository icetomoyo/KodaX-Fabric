CREATE TABLE "channel_seats" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "employee_id" bigint NOT NULL,
  "product_line_id" bigint NOT NULL,
  "credential_id" bigint,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "channel_seats" ADD CONSTRAINT "channel_seats_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "channel_seats" ADD CONSTRAINT "channel_seats_product_line_id_product_lines_id_fk" FOREIGN KEY ("product_line_id") REFERENCES "product_lines"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "channel_seats" ADD CONSTRAINT "channel_seats_credential_id_upstream_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "upstream_credentials"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX "channel_seats_employee_product_line_uidx" ON "channel_seats" USING btree ("employee_id", "product_line_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "channel_seats_credential_uidx" ON "channel_seats" USING btree ("credential_id");
