DROP INDEX IF EXISTS "credential_bindings_product_line_scope_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX "credential_bindings_product_line_scope_uidx" ON "credential_bindings" USING btree ("product_line_id", "scope_type", "scope_id") WHERE "scope_type" <> 'enterprise';
--> statement-breakpoint
CREATE TABLE "credential_binding_members" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "binding_id" bigint NOT NULL,
  "employee_id" bigint NOT NULL,
  "product_line_id" bigint NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "credential_binding_members" ADD CONSTRAINT "credential_binding_members_binding_id_credential_bindings_id_fk" FOREIGN KEY ("binding_id") REFERENCES "credential_bindings"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "credential_binding_members" ADD CONSTRAINT "credential_binding_members_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "credential_binding_members" ADD CONSTRAINT "credential_binding_members_product_line_id_product_lines_id_fk" FOREIGN KEY ("product_line_id") REFERENCES "product_lines"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX "credential_binding_members_binding_employee_uidx" ON "credential_binding_members" USING btree ("binding_id", "employee_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "credential_binding_members_employee_product_line_uidx" ON "credential_binding_members" USING btree ("employee_id", "product_line_id");
--> statement-breakpoint
CREATE INDEX "credential_binding_members_binding_idx" ON "credential_binding_members" USING btree ("binding_id");
--> statement-breakpoint
UPDATE "credential_bindings" AS b
SET "scope_type" = 'enterprise',
    "scope_id" = d."enterprise_id",
    "updated_at" = now()
FROM "departments" AS d
WHERE b."scope_type" = 'department'
  AND d."id" = b."scope_id"
  AND d."enterprise_id" IS NOT NULL;
