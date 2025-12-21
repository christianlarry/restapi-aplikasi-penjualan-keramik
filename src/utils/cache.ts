import redisClient from "@/config/redis";
import { logger } from "@/config/logger";

/**
 * Tries to get data from cache. 
 * If missing, runs the callback (DB query), saves result to cache, and returns it.
 * @param key Cache key
 * @param callback Async function to fetch data if cache miss
 * @param ttl Time to live in seconds (default 3600 = 1 hour)
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
    // Fallback to DB if Redis fails
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
 * Deletes all keys matching a pattern (e.g. "docs:list:*")
 * Uses SCAN to be performant and non-blocking
 */
export const clearKeys = async (pattern: string) => {
  try {
    const stream = redisClient.scanStream({
      match: pattern,
      count: 100 // Process in batches
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
