import { buildApp } from "./app.js";
import { env } from "./config.js";
import { pingRedis } from "./redis.js";
import { sql } from "./db/client.js";
import { startAuditBodyRetention } from "./lib/relay/audit-retention.js";

async function main() {
  await sql`select 1`;
  await pingRedis();

  const app = await buildApp();
  startAuditBodyRetention({
    keepLast: env.AUDIT_BODY_KEEP_LAST,
    intervalMs: env.AUDIT_BODY_PRUNE_INTERVAL_MS,
    log: app.log,
  });
  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(`TokenHub API listening on http://${env.HOST}:${env.PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
