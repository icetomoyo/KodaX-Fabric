import { buildApp } from "./app.js";
import { env } from "./config.js";
import { pingRedis } from "./redis.js";
import { sql } from "./db/client.js";
import { startCapacityAlert, stopCapacityAlert } from "./lib/capacity-alert.js";
import { startIdleBindingRelease, stopIdleBindingRelease } from "./lib/idle-binding-release.js";
import {
  startRequestContextStorageScan,
  stopRequestContextStorageScan,
} from "./lib/request-context-storage.js";
import { startTierRebind, stopTierRebind } from "./lib/tier-rebind.js";

async function main() {
  await sql`select 1`;
  await pingRedis();

  const app = await buildApp();
  startCapacityAlert(app.log);
  startIdleBindingRelease(app.log);
  startTierRebind(app.log);
  startRequestContextStorageScan(app.log);
  app.addHook("onClose", async () => {
    stopCapacityAlert();
    stopIdleBindingRelease();
    stopTierRebind();
    stopRequestContextStorageScan();
  });
  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(`TokenHub API listening on http://${env.HOST}:${env.PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
