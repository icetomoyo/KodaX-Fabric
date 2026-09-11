ALTER TABLE "channel_seats" ADD COLUMN "tag" varchar(32) DEFAULT '' NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "channel_seats_employee_product_line_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX "channel_seats_employee_product_line_tag_uidx" ON "channel_seats" USING btree ("employee_id","product_line_id","tag");
