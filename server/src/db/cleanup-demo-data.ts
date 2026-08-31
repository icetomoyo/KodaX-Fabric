/**
 * 清理业务演示/联调数据。
 * 保留：employees、system_settings
 * 删除：员工 API Key、渠道配置、凭证绑定、调用审计、用量计数、操作审计、工单
 *
 * 员工 Key 强制引用 ProductLine，因此 Key 与渠道必须在同一事务中清理。
 */
import { sql } from "./client.js";

async function main() {
  await sql`select 1`;

  const [remaining] = await sql.begin(async (tx) => {
    await tx`delete from request_audit_bodies`;
    await tx`delete from request_audits`;
    await tx`delete from usage_counters_team_daily`;
    await tx`delete from usage_counters_daily`;
    await tx`delete from credential_bindings`;
    await tx`delete from employee_api_keys`;
    await tx`delete from upstream_credentials`;
    await tx`delete from model_routes`;
    await tx`delete from product_lines`;
    await tx`delete from providers`;
    await tx`delete from ops_audit_logs`;
    await tx`delete from tickets`;

    return tx`
      select
        (select count(*)::int from employees) as employees,
        (select count(*)::int from employee_api_keys) as api_keys,
        (select count(*)::int from providers) as providers,
        (select count(*)::int from upstream_credentials) as credentials,
        (select count(*)::int from model_routes) as model_routes,
        (select count(*)::int from tickets) as tickets
    `;
  });

  console.log("remaining counts:", remaining);
  console.log("Cleanup complete. Employee accounts and system baseline retained.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });
