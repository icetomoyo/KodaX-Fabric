import { buildApp } from "./app.js";
import { env } from "./config.js";
import { pingRedis } from "./redis.js";
import { sql } from "./db/client.js";
import { startCapacityAlert, stopCapacityAlert } from "./lib/capacity-alert.js";
import { startTierRebind, stopTierRebind } from "./lib/tier-rebind.js";

async function main() {
  await sql`select 1`;
  await pingRedis();

  const app = await buildApp();
  startCapacityAlert(app.log);
  startTierRebind(app.log);
  app.addHook("onClose", async () => {
    stopCapacityAlert();
    stopTierRebind();
  });
  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(`TokenHub API listening on http://${env.HOST}:${env.PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
