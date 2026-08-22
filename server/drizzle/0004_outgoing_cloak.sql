ALTER TYPE "public"."enterprise_status" ADD VALUE 'pending' BEFORE 'active';--> statement-breakpoint
ALTER TABLE "employees" ALTER COLUMN "enterprise_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "enterprises" ADD COLUMN "code" varchar(16);--> statement-breakpoint
UPDATE "enterprises"
SET "code" = 'E' || lpad("id"::text, 8, '0')
WHERE "code" IS NULL;--> statement-breakpoint
ALTER TABLE "enterprises" ALTER COLUMN "code" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "enterprises_code_uidx" ON "enterprises" USING btree ("code");