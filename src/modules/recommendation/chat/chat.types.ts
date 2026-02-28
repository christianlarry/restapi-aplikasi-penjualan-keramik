import { ObjectId } from "mongodb"
import { Content } from "@google/genai"
import { GetProductResponse } from "@/modules/product/product.types"

export interface ChatTurn {
  role: "user" | "assistant"
  text: string
  products?: GetProductResponse[]
  timestamp: Date
}

export interface ChatSession {
  _id?: ObjectId
  sessionId: string
  contents: Content[]
  displayHistory: ChatTurn[]
  lastProducts: GetProductResponse[]
  createdAt: Date
  updatedAt: Date
  expiresAt: Date
}

/** Maximum number of user+assistant turns allowed per session */
export const MAX_TURNS_PER_SESSION = 20

/** Session TTL in hours — reset on each new turn */
export const SESSION_TTL_HOURS = 24
