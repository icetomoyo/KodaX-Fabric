import Redis from "ioredis";
import { env } from "./config.js";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 2,
  lazyConnect: true,
});

export async function pingRedis(): Promise<boolean> {
  if (redis.status !== "ready") {
    await redis.connect();
  }
  const pong = await redis.ping();
  return pong === "PONG";
}
