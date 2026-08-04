/**
 * 清理非用户业务演示/联调假数据。
 * 保留：employees、employee_api_keys、quota_policies、system_settings
 * 删除：供应商、产品线、凭证、模型路由、授权、调用审计、用量计数、操作审计
 */
import { sql } from "./client.js";

async function clear(table: string) {
  await sql.unsafe(`delete from ${table}`);
  const [{ n }] = await sql.unsafe(`select count(*)::int as n from ${table}`);
  console.log(`cleared ${table}, remaining=${n}`);
}

async function main() {
  await sql`select 1`;

  // FK-safe order
  await clear("request_audit_bodies");
  await clear("request_audits");
  await clear("usage_counters_daily");
  await clear("credential_employee_grants");
  await clear("log_access_grants");
  await clear("upstream_credentials");
  await clear("model_routes");
  await clear("product_lines");
  await clear("providers");
  await clear("ops_audit_logs");
  await clear("employee_quota_overrides");

  const remaining = await sql`
    select
      (select count(*)::int from employees) as employees,
      (select count(*)::int from employee_api_keys) as api_keys,
      (select count(*)::int from providers) as providers,
      (select count(*)::int from upstream_credentials) as credentials,
      (select count(*)::int from model_routes) as model_routes,
      (select count(*)::int from quota_policies) as quota_policies
  `;
  console.log("remaining counts:", remaining[0]);
  await sql.end({ timeout: 5 });
  console.log("Cleanup complete. Users retained.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
