import type { FastifyInstance } from "fastify";
import { sql } from "../db/client.js";
import { pingRedis } from "../redis.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    let postgres = false;
    let redis = false;
    let postgresError: string | undefined;
    let redisError: string | undefined;

    try {
      await sql`select 1`;
      postgres = true;
    } catch (e) {
      postgresError = e instanceof Error ? e.message : String(e);
    }

    try {
      redis = await pingRedis();
    } catch (e) {
      redisError = e instanceof Error ? e.message : String(e);
    }

    const ok = postgres && redis;
    return {
      ok,
      service: "tokenhub-api",
      postgres,
      redis,
      postgresError,
      redisError,
      time: new Date().toISOString(),
    };
  });
}
