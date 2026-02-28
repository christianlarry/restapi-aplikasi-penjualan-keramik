import { GoogleGenAI } from "@google/genai"
import { env } from "@/core/config/env"

export const genAI = new GoogleGenAI({
  apiKey: env.GOOGLE_API_KEY,
})

export const genAIModel = "gemini-2.5-flash"
