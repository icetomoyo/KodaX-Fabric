-- One channel = one KEY pool. relay_pool_key is the provider code, written by
-- application code. Drop the 0044 triggers that filled glm:coding_plan / line:<id>.
UPDATE "product_lines" AS pl
SET "relay_pool_key" = p."code"
FROM "providers" AS p
WHERE p."id" = pl."provider_id";
--> statement-breakpoint
DELETE FROM "credential_bindings" AS b
USING (
  SELECT b2."id",
    row_number() OVER (
      PARTITION BY pl."relay_pool_key", b2."scope_type", b2."scope_id"
      ORDER BY b2."bound_at" DESC, b2."id" DESC
    ) AS rn
  FROM "credential_bindings" AS b2
  INNER JOIN "product_lines" AS pl ON pl."id" = b2."product_line_id"
  WHERE b2."scope_type" <> 'enterprise'
) AS d
WHERE b."id" = d."id" AND d.rn > 1;
--> statement-breakpoint
DELETE FROM "credential_binding_members" AS m
USING (
  SELECT m2."id",
    row_number() OVER (
      PARTITION BY m2."employee_id", pl."relay_pool_key"
      ORDER BY m2."id" DESC
    ) AS rn
  FROM "credential_binding_members" AS m2
  INNER JOIN "product_lines" AS pl ON pl."id" = m2."product_line_id"
) AS d
WHERE m."id" = d."id" AND d.rn > 1;
--> statement-breakpoint
UPDATE "credential_bindings" AS b
SET "relay_pool_key" = pl."relay_pool_key"
FROM "product_lines" AS pl
WHERE pl."id" = b."product_line_id";
--> statement-breakpoint
UPDATE "credential_binding_members" AS m
SET "relay_pool_key" = pl."relay_pool_key"
FROM "product_lines" AS pl
WHERE pl."id" = m."product_line_id";
--> statement-breakpoint
DROP TRIGGER IF EXISTS product_lines_fill_relay_pool_key ON "product_lines";
--> statement-breakpoint
DROP TRIGGER IF EXISTS credential_bindings_fill_relay_pool_key ON "credential_bindings";
--> statement-breakpoint
DROP TRIGGER IF EXISTS credential_binding_members_fill_relay_pool_key ON "credential_binding_members";
--> statement-breakpoint
DROP FUNCTION IF EXISTS product_lines_fill_relay_pool_key();
--> statement-breakpoint
DROP FUNCTION IF EXISTS credential_bindings_fill_relay_pool_key();
--> statement-breakpoint
DROP FUNCTION IF EXISTS credential_binding_members_fill_relay_pool_key();
