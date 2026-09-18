ALTER TABLE "product_lines" ADD COLUMN "relay_pool_key" varchar(64) DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE "product_lines" AS pl
SET "relay_pool_key" = CASE
  WHEN p."code" = 'glm' AND pl."product_type" = 'coding_plan' THEN 'glm:coding_plan'
  ELSE 'line:' || pl."id"::text
END
FROM "providers" AS p
WHERE p."id" = pl."provider_id";
--> statement-breakpoint
CREATE INDEX "product_lines_relay_pool_key_idx" ON "product_lines" USING btree ("relay_pool_key");
--> statement-breakpoint
ALTER TABLE "credential_bindings" ADD COLUMN "relay_pool_key" varchar(64) DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE "credential_bindings" AS b
SET "relay_pool_key" = pl."relay_pool_key"
FROM "product_lines" AS pl
WHERE pl."id" = b."product_line_id";
--> statement-breakpoint
ALTER TABLE "credential_binding_members" ADD COLUMN "relay_pool_key" varchar(64) DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE "credential_binding_members" AS m
SET "relay_pool_key" = pl."relay_pool_key"
FROM "product_lines" AS pl
WHERE pl."id" = m."product_line_id";
--> statement-breakpoint
DELETE FROM "credential_bindings" AS b
USING (
  SELECT "id",
    row_number() OVER (
      PARTITION BY "relay_pool_key", "scope_type", "scope_id"
      ORDER BY "bound_at" DESC, "id" DESC
    ) AS rn
  FROM "credential_bindings"
  WHERE "scope_type" <> 'enterprise'
) AS d
WHERE b."id" = d."id" AND d.rn > 1;
--> statement-breakpoint
DELETE FROM "credential_binding_members" AS m
USING (
  SELECT "id",
    row_number() OVER (
      PARTITION BY "employee_id", "relay_pool_key"
      ORDER BY "id" DESC
    ) AS rn
  FROM "credential_binding_members"
) AS d
WHERE m."id" = d."id" AND d.rn > 1;
--> statement-breakpoint
DROP INDEX IF EXISTS "credential_bindings_product_line_scope_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX "credential_bindings_pool_scope_uidx" ON "credential_bindings" USING btree ("relay_pool_key", "scope_type", "scope_id") WHERE "scope_type" <> 'enterprise';
--> statement-breakpoint
DROP INDEX IF EXISTS "credential_binding_members_employee_product_line_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX "credential_binding_members_employee_pool_uidx" ON "credential_binding_members" USING btree ("employee_id", "relay_pool_key");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION product_lines_fill_relay_pool_key()
RETURNS trigger AS $$
DECLARE
  provider_code text;
BEGIN
  IF NEW.relay_pool_key IS NOT NULL
     AND NEW.relay_pool_key <> ''
     AND NEW.relay_pool_key <> 'line:pending' THEN
    RETURN NEW;
  END IF;
  SELECT p.code INTO provider_code FROM providers p WHERE p.id = NEW.provider_id;
  IF provider_code = 'glm' AND NEW.product_type = 'coding_plan' THEN
    NEW.relay_pool_key := 'glm:coding_plan';
  ELSIF NEW.id IS NOT NULL THEN
    NEW.relay_pool_key := 'line:' || NEW.id::text;
  ELSE
    NEW.relay_pool_key := 'line:pending';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS product_lines_fill_relay_pool_key ON "product_lines";
--> statement-breakpoint
CREATE TRIGGER product_lines_fill_relay_pool_key
BEFORE INSERT ON "product_lines"
FOR EACH ROW
EXECUTE FUNCTION product_lines_fill_relay_pool_key();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION credential_bindings_fill_relay_pool_key()
RETURNS trigger AS $$
BEGIN
  IF NEW.relay_pool_key IS NULL OR NEW.relay_pool_key = '' THEN
    SELECT pl.relay_pool_key INTO NEW.relay_pool_key
    FROM product_lines pl
    WHERE pl.id = NEW.product_line_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS credential_bindings_fill_relay_pool_key ON "credential_bindings";
--> statement-breakpoint
CREATE TRIGGER credential_bindings_fill_relay_pool_key
BEFORE INSERT ON "credential_bindings"
FOR EACH ROW
EXECUTE FUNCTION credential_bindings_fill_relay_pool_key();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION credential_binding_members_fill_relay_pool_key()
RETURNS trigger AS $$
BEGIN
  IF NEW.relay_pool_key IS NULL OR NEW.relay_pool_key = '' THEN
    SELECT pl.relay_pool_key INTO NEW.relay_pool_key
    FROM product_lines pl
    WHERE pl.id = NEW.product_line_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS credential_binding_members_fill_relay_pool_key ON "credential_binding_members";
--> statement-breakpoint
CREATE TRIGGER credential_binding_members_fill_relay_pool_key
BEFORE INSERT ON "credential_binding_members"
FOR EACH ROW
EXECUTE FUNCTION credential_binding_members_fill_relay_pool_key();
