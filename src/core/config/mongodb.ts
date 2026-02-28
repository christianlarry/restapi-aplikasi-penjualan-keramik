import { Db, MongoClient } from "mongodb"
import { env } from "@/core/config/env"
import { logger } from "@/core/config/logger"

let mongoClient: MongoClient | null = null
let mongoDb: Db | null = null
let connectPromise: Promise<Db> | null = null

const createMongoClient = () => {
  return new MongoClient(env.MONGODB_URI, {
    maxPoolSize: 20,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    socketTimeoutMS: 30_000,
  })
}

export const connectToMongoDB = async (): Promise<Db> => {
  if (mongoDb) return mongoDb
  if (connectPromise) return connectPromise

  connectPromise = (async () => {
    if (!mongoClient) mongoClient = createMongoClient()

    await mongoClient.connect()
    mongoDb = mongoClient.db(env.MONGODB_DB_NAME)

    // Health-check to fail fast on bad credentials/cluster issues.
    await mongoDb.command({ ping: 1 })

    logger.info("✅ Connected to MongoDB")
    return mongoDb
  })()

  try {
    return await connectPromise
  } catch (error) {
    connectPromise = null
    mongoDb = null
    if (mongoClient) {
      try {
        await mongoClient.close()
      } catch {
        // ignore
      }
      mongoClient = null
    }
    logger.error("❌ MongoDB Connection Error:", error)
    throw error
  }
}

export const getDb = (): Db => {
  if (!mongoDb) {
    throw new Error("MongoDB is not connected. Call connectToMongoDB() first.")
  }
  return mongoDb
}

export const getMongoClient = (): MongoClient => {
  if (!mongoClient) {
    throw new Error("MongoClient is not initialized. Call connectToMongoDB() first.")
  }
  return mongoClient
}

export const disconnectFromMongoDB = async (): Promise<void> => {
  if (connectPromise) {
    try {
      await connectPromise
    } catch {
      // ignore
    }
  }

  if (!mongoClient) return

  try {
    await mongoClient.close()
    logger.info("MongoDB connection closed")
  } finally {
    mongoClient = null
    mongoDb = null
    connectPromise = null
  }
}
