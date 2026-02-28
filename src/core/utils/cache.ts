import redisClient from "@/core/config/redis";
import { logger } from "@/core/config/logger";

/**
 * Tries to get data from cache.
 * If missing, runs the callback (DB query), saves result to cache, and returns it.
 */
export const getOrSet = async <T>(
  key: string,
  callback: () => Promise<T>,
  ttl: number = 3600
): Promise<T> => {
  try {
    const cachedData = await redisClient.get(key);
    if (cachedData) {
      logger.debug(`Cache HIT for key: ${key}`);
      return JSON.parse(cachedData) as T;
    }
  } catch (error) {
    logger.error(`Redis GET error for key ${key}:`, error);
  }

  logger.debug(`Cache MISS for key: ${key}`);
  const data = await callback();

  try {
    if (data) {
      await redisClient.setex(key, ttl, JSON.stringify(data));
    }
  } catch (error) {
    logger.error(`Redis SET error for key ${key}:`, error);
  }

  return data;
};

/**
 * Deletes a specific key from cache
 */
export const del = async (key: string) => {
  try {
    await redisClient.del(key);
  } catch (error) {
    logger.error(`Redis DEL error for key ${key}:`, error);
  }
}

/**
 * Deletes all keys matching a pattern (e.g. "products:list:*")
 * Uses SCAN to be performant and non-blocking
 */
export const clearKeys = async (pattern: string) => {
  try {
    const stream = redisClient.scanStream({
      match: pattern,
      count: 100
    });

    stream.on("data", (keys: string[]) => {
      if (keys.length) {
        const pipeline = redisClient.pipeline();
        keys.forEach(key => pipeline.del(key));
        pipeline.exec();
      }
    });

    stream.on("end", () => {
      logger.debug(`Cleared cache pattern: ${pattern}`);
    });

  } catch (error) {
    logger.error(`Redis clearKeys error for pattern ${pattern}:`, error);
  }
}
