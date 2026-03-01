/**
 * Provider-agnostic LLM abstraction layer.
 *
 * This module defines the interfaces used across Gemini and Ollama implementations
 * so the recommendation engine can work with any LLM provider.
 */

// ─── Tool Schema ──────────────────────────────────────────────────────────────

export interface LLMToolPropertySchema {
  type: "string" | "number" | "boolean" | "object" | "array"
  description?: string
  /** Allowed values — provider converts this to enum constraint */
  enum?: string[]
  /** Schema for array items */
  items?: LLMToolPropertySchema
  /** Schema for nested object properties */
  properties?: Record<string, LLMToolPropertySchema>
}

export interface LLMTool {
  name: string
  description: string
  parameters: {
    type: "object"
    properties: Record<string, LLMToolPropertySchema>
  }
}

// ─── Messages ─────────────────────────────────────────────────────────────────

/**
 * Provider-agnostic message that can represent all roles in a multi-turn
 * conversation including tool call and tool result turns.
 */
export interface LLMMessage {
  role: "user" | "assistant" | "tool_result"
  /** Plain text content — present for user and assistant text turns */
  text?: string
  /** Present when the model wants to invoke a tool */
  toolCall?: {
    name: string
    arguments: Record<string, unknown>
  }
  /** Present for tool_result turns (the response fed back to the model) */
  toolResult?: {
    name: string
    result: unknown
  }
}

// ─── Single-turn response ─────────────────────────────────────────────────────

export interface LLMSingleTurnResult {
  /** Present when the model replies with natural language */
  text?: string
  /** Present when the model wants to call a tool */
  toolCall?: {
    name: string
    arguments: Record<string, unknown>
  }
  /** The response as a generic LLMMessage — append to history after each turn */
  rawMessage: LLMMessage
}

// ─── Service interface ────────────────────────────────────────────────────────

export interface ILLMService {
  /**
   * Perform a single generation turn.
   *
   * @param messages     Full conversation history up to (and including) the current user message
   * @param systemPrompt System instruction to set model persona / behaviour
   * @param tools        Tools the model may invoke (optional)
   */
  chat(
    messages: LLMMessage[],
    systemPrompt: string,
    tools?: LLMTool[]
  ): Promise<LLMSingleTurnResult>
}
