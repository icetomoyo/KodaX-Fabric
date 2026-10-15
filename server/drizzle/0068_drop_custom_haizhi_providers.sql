DELETE FROM "providers"
WHERE "code" IN ('custom', 'haizhi')
  AND NOT EXISTS (
    SELECT 1 FROM "product_lines"
    WHERE "product_lines"."provider_id" = "providers"."id"
  );
