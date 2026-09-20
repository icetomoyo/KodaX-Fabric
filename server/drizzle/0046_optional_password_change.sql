ALTER TABLE "employees" ALTER COLUMN "must_change_password" SET DEFAULT false;
--> statement-breakpoint
UPDATE "employees" SET "must_change_password" = false WHERE "must_change_password" = true;
