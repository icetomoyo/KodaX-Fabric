import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const { buildByProviderTodayQuery } = await import("../src/routes/admin/overview.js");

test("workbench provider totals fall back to the Key channel when provider_code is missing", () => {
  const compiled = buildByProviderTodayQuery(undefined).toSQL().sql.replace(/\s+/g, " ");
  assert.match(compiled, /coalesce\("request_audits"\."provider_code", "providers"\."code"\)/);
  assert.match(compiled, /left join "product_lines"/);
  assert.match(compiled, /left join "providers"/);
});
