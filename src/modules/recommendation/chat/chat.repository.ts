import { getDb } from "@/core/config/mongodb"
import { ChatSession } from "./chat.types"
import { logger } from "@/core/config/logger"

const COLLECTION = "chat_sessions"

const getCollection = () => getDb().collection<ChatSession>(COLLECTION)

/**
 * Ensure TTL index exists on `expiresAt`.
 * Called once at app startup.
 */
const ensureIndexes = async () => {
  const col = getCollection()
  await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  await col.createIndex({ sessionId: 1 }, { unique: true })
  logger.info("✅ chat_sessions indexes ensured (TTL + sessionId)")
}

const findBySessionId = async (sessionId: string): Promise<ChatSession | null> => {
  return getCollection().findOne({ sessionId })
}

const insertOne = async (session: ChatSession): Promise<void> => {
  await getCollection().insertOne(session)
}

const updateSession = async (
  sessionId: string,
  update: Partial<Pick<ChatSession, "contents" | "displayHistory" | "lastProducts" | "updatedAt" | "expiresAt">>
): Promise<void> => {
  await getCollection().updateOne(
    { sessionId },
    { $set: update }
  )
}

const deleteBySessionId = async (sessionId: string): Promise<boolean> => {
  const result = await getCollection().deleteOne({ sessionId })
  return result.deletedCount === 1
}

export default {
  ensureIndexes,
  findBySessionId,
  insertOne,
  updateSession,
  deleteBySessionId
}
