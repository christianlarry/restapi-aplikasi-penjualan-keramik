import { randomUUID } from "crypto"
import { ResponseError } from "@/core/errors/ResponseError"
import geminiService from "@/modules/recommendation/gemini.service"
import chatRepository from "./chat.repository"
import { ChatSession, ChatTurn, MAX_TURNS_PER_SESSION, SESSION_TTL_HOURS } from "./chat.types"

const buildExpiresAt = () => {
  const date = new Date()
  date.setHours(date.getHours() + SESSION_TTL_HOURS)
  return date
}

/**
 * Start a new chat session or continue an existing one.
 */
const chat = async (prompt: string, sessionId?: string) => {
  // ── Continue existing session ──
  if (sessionId) {
    const session = await chatRepository.findBySessionId(sessionId)
    if (!session) {
      throw new ResponseError(404, "Chat session not found or expired. Start a new conversation.")
    }

    // Check turn limit (count user turns only)
    const userTurns = session.displayHistory.filter(t => t.role === "user").length
    if (userTurns >= MAX_TURNS_PER_SESSION) {
      throw new ResponseError(400, `Maximum ${MAX_TURNS_PER_SESSION} turns reached. Please start a new session.`)
    }

    const result = await geminiService.getProductRecommendations(prompt, session.contents)

    const now = new Date()
    const userTurn: ChatTurn = { role: "user", text: prompt, timestamp: now }
    const assistantTurn: ChatTurn = {
      role: "assistant",
      text: result.message ?? "",
      products: result.products && result.products.length > 0 ? result.products : undefined,
      timestamp: now
    }

    const updatedHistory = [...session.displayHistory, userTurn, assistantTurn]

    await chatRepository.updateSession(sessionId, {
      contents: result.updatedContents,
      displayHistory: updatedHistory,
      lastProducts: result.products ?? [],
      updatedAt: now,
      expiresAt: buildExpiresAt()
    })

    return {
      sessionId,
      message: result.message,
      products: result.products,
      history: updatedHistory
    }
  }

  // ── Create new session ──
  const result = await geminiService.getProductRecommendations(prompt)

  const now = new Date()
  const newSessionId = randomUUID()

  const userTurn: ChatTurn = { role: "user", text: prompt, timestamp: now }
  const assistantTurn: ChatTurn = {
    role: "assistant",
    text: result.message ?? "",
    products: result.products && result.products.length > 0 ? result.products : undefined,
    timestamp: now
  }

  const session: ChatSession = {
    sessionId: newSessionId,
    contents: result.updatedContents,
    displayHistory: [userTurn, assistantTurn],
    lastProducts: result.products ?? [],
    createdAt: now,
    updatedAt: now,
    expiresAt: buildExpiresAt()
  }

  await chatRepository.insertOne(session)

  return {
    sessionId: newSessionId,
    message: result.message,
    products: result.products,
    history: session.displayHistory
  }
}

/**
 * Get session history without sending a new prompt.
 */
const getHistory = async (sessionId: string) => {
  const session = await chatRepository.findBySessionId(sessionId)
  if (!session) {
    throw new ResponseError(404, "Chat session not found or expired.")
  }

  return {
    sessionId: session.sessionId,
    history: session.displayHistory,
    lastProducts: session.lastProducts,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  }
}

/**
 * Delete a session explicitly.
 */
const deleteSession = async (sessionId: string) => {
  const deleted = await chatRepository.deleteBySessionId(sessionId)
  if (!deleted) {
    throw new ResponseError(404, "Chat session not found or expired.")
  }
}

export default {
  chat,
  getHistory,
  deleteSession
}
