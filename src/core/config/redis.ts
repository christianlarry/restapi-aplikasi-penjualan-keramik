import Redis from "ioredis";
import { env } from "@/core/config/env";
import { logger } from "@/core/config/logger";

const redisClient = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || "",
  lazyConnect: true,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redisClient.on("connect", () => {
  logger.info("🔥 Redis client connected");
});

redisClient.on("error", (err) => {
  logger.error("Redis client error:", err);
});

redisClient.connect().catch((err) => {
  logger.error("Failed to connect to Redis on startup:", err);
});

export const disconnectRedis = async () => {
  try {
    await redisClient.quit();
    logger.info("Redis connection closed");
  } catch (err) {
    logger.error("Error closing Redis connection:", err);
    throw err;
  }
};

export default redisClient;
