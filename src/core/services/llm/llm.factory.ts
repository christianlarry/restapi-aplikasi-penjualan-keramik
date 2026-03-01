import { env } from "@/core/config/env"
import type { ILLMService } from "@/core/types/llm.types"
import { GeminiLLMService } from "./gemini.llm"
import { OllamaLLMService } from "./ollama.llm"
import { logger } from "@/core/config/logger"

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
const DEFAULT_OLLAMA_MODEL = "llama3.1:8b"

const createLLMService = (): ILLMService => {
  if (env.LLM_PROVIDER === "ollama") {
    const model = env.LLM_MODEL ?? DEFAULT_OLLAMA_MODEL
    logger.info(`[LLMFactory] Using Ollama — model: ${model}`)
    return new OllamaLLMService(env.OLLAMA_BASE_URL!, model)
  }

  const model = env.LLM_MODEL ?? DEFAULT_GEMINI_MODEL
  logger.info(`[LLMFactory] Using Gemini — model: ${model}`)
  return new GeminiLLMService(model)
}

/** Singleton LLM service — provider selected from LLM_PROVIDER env var */
export const llmService: ILLMService = createLLMService()
