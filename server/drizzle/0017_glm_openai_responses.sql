UPDATE "product_lines" AS pl
SET
  "protocol_configs" = jsonb_set(
    coalesce(pl."protocol_configs", '{}'::jsonb),
    '{openai_responses}',
    '{"baseUrl":"https://open.bigmodel.cn/api/v1","authStyle":"bearer"}'::jsonb,
    true
  ),
  "updated_at" = now()
FROM "providers" AS p
WHERE pl."provider_id" = p."id"
  AND p."code" = 'glm'
  AND pl."code" = 'api'
  AND pl."protocol_configs" -> 'openai_responses' IS NULL;
--> statement-breakpoint
UPDATE "product_lines" AS pl
SET
  "protocol_configs" = jsonb_set(
    coalesce(pl."protocol_configs", '{}'::jsonb),
    '{openai_responses}',
    '{"baseUrl":"https://api.z.ai/api/v1","authStyle":"bearer"}'::jsonb,
    true
  ),
  "updated_at" = now()
FROM "providers" AS p
WHERE pl."provider_id" = p."id"
  AND p."code" = 'glm'
  AND pl."code" = 'api_intl'
  AND pl."protocol_configs" -> 'openai_responses' IS NULL;
--> statement-breakpoint
UPDATE "upstream_credentials" AS uc
SET
  "supported_protocols" = CASE
    WHEN NOT ('openai_responses' = ANY (uc."supported_protocols"))
    THEN array_append(uc."supported_protocols", 'openai_responses'::relay_protocol)
    ELSE uc."supported_protocols"
  END,
  "updated_at" = now()
FROM "product_lines" AS pl
JOIN "providers" AS p ON p."id" = pl."provider_id"
WHERE uc."product_line_id" = pl."id"
  AND p."code" = 'glm';
