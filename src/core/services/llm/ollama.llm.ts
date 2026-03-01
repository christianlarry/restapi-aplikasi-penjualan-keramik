import { Ollama, Message as OllamaMessage, Tool as OllamaTool } from "ollama"
import { logger } from "@/core/config/logger"
import type { ILLMService, LLMMessage, LLMSingleTurnResult, LLMTool, LLMToolPropertySchema } from "@/core/types/llm.types"

export class OllamaLLMService implements ILLMService {
  private ollama: Ollama

  constructor(
    private readonly baseUrl: string,
    private readonly model: string
  ) {
    this.ollama = new Ollama({ host: baseUrl })
    logger.info(`[Ollama] Initialized — model: ${model}, host: ${baseUrl}`)
  }

  async chat(
    messages: LLMMessage[],
    systemPrompt: string,
    tools: LLMTool[] = []
  ): Promise<LLMSingleTurnResult> {
    const ollamaMessages: OllamaMessage[] = [
      { role: "system", content: systemPrompt },
      ...this.messagesToOllama(messages)
    ]

    const response = await this.ollama.chat({
      model: this.model,
      messages: ollamaMessages,
      tools: tools.length > 0 ? tools.map(t => this.toolToOllama(t)) : undefined,
      stream: false
    })

    const msg = response.message

    // ── Tool call response ──
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const call = msg.tool_calls[0]
      const toolCall = {
        name: call.function.name,
        arguments: call.function.arguments as Record<string, unknown>
      }

      logger.info(`[Ollama] Tool call: ${toolCall.name}\n${JSON.stringify(toolCall.arguments)}`)

      return {
        toolCall,
        rawMessage: { role: "assistant", toolCall }
      }
    }

    // ── Text response ──
    return {
      text: msg.content,
      rawMessage: { role: "assistant", text: msg.content }
    }
  }

  // ─── Converters ──────────────────────────────────────────────────────────────

  private messagesToOllama(messages: LLMMessage[]): OllamaMessage[] {
    return messages.map(msg => {
      if (msg.role === "user") {
        return { role: "user", content: msg.text ?? "" }
      }
      if (msg.role === "assistant" && msg.toolCall) {
        return {
          role: "assistant",
          content: "",
          tool_calls: [{
            function: {
              name: msg.toolCall.name,
              arguments: msg.toolCall.arguments
            }
          }]
        } as OllamaMessage
      }
      if (msg.role === "assistant") {
        return { role: "assistant", content: msg.text ?? "" }
      }
      if (msg.role === "tool_result" && msg.toolResult) {
        return {
          role: "tool",
          content: JSON.stringify(msg.toolResult.result)
        } as OllamaMessage
      }
      return { role: "user", content: msg.text ?? "" }
    })
  }

  private toolToOllama(tool: LLMTool): OllamaTool {
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
          required: [],
          properties: Object.fromEntries(
            Object.entries(tool.parameters.properties).map(([k, v]) => [k, this.convertPropertySchema(v)])
          )
        }
      }
    }
  }

  private convertPropertySchema(prop: LLMToolPropertySchema): object {
    const schema: Record<string, unknown> = { type: prop.type }
    if (prop.description) schema.description = prop.description
    if (prop.enum) schema.enum = prop.enum
    if (prop.items) schema.items = this.convertPropertySchema(prop.items)
    if (prop.properties) {
      schema.properties = Object.fromEntries(
        Object.entries(prop.properties).map(([k, v]) => [k, this.convertPropertySchema(v)])
      )
    }
    return schema
  }
}
