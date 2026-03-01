import Groq from "groq-sdk"
import type { ChatCompletionMessageParam, ChatCompletionTool } from "groq-sdk/resources/chat/completions"
import { logger } from "@/core/config/logger"
import type { ILLMService, LLMMessage, LLMSingleTurnResult, LLMTool, LLMToolPropertySchema } from "@/core/types/llm.types"

export class QroqLLMService implements ILLMService {
  private groq: Groq

  constructor(
    private readonly apiKey: string,
    private readonly model: string
  ) {
    this.groq = new Groq({ apiKey })
    logger.info(`[Groq] Initialized — model: ${model}`)
  }

  async chat(
    messages: LLMMessage[],
    systemPrompt: string,
    tools: LLMTool[] = []
  ): Promise<LLMSingleTurnResult> {
    const groqMessages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...this.messagesToGroq(messages)
    ]

    const response = await this.groq.chat.completions.create({
      model: this.model,
      messages: groqMessages,
      tools: tools.length > 0 ? tools.map(t => this.toolToGroq(t)) : undefined,
      tool_choice: tools.length > 0 ? "auto" : undefined
    })

    const message = response.choices[0].message

    // ── Tool call response ──
    if (message.tool_calls && message.tool_calls.length > 0) {
      const call = message.tool_calls[0]
      const toolCallId = call.id
      const toolCall = {
        name: call.function.name,
        // Groq returns arguments as a JSON string — parse it
        arguments: JSON.parse(call.function.arguments) as Record<string, unknown>
      }

      logger.info(`[Groq] Tool call: ${toolCall.name} (id: ${toolCallId})\n${call.function.arguments}`)

      return {
        toolCall,
        rawMessage: { role: "assistant", toolCall, toolCallId }
      }
    }

    // ── Text response ──
    const text = message.content ?? ""
    return {
      text,
      rawMessage: { role: "assistant", text }
    }
  }

  // ─── Converters ──────────────────────────────────────────────────────────────

  private messagesToGroq(messages: LLMMessage[]): ChatCompletionMessageParam[] {
    const result: ChatCompletionMessageParam[] = []

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]

      if (msg.role === "user") {
        result.push({ role: "user", content: msg.text ?? "" })
        continue
      }

      if (msg.role === "assistant" && msg.toolCall) {
        result.push({
          role: "assistant",
          content: null,
          tool_calls: [{
            id: msg.toolCallId ?? `call_${i}`,
            type: "function",
            function: {
              name: msg.toolCall.name,
              // Groq expects arguments as a JSON string
              arguments: JSON.stringify(msg.toolCall.arguments)
            }
          }]
        })
        continue
      }

      if (msg.role === "assistant") {
        result.push({ role: "assistant", content: msg.text ?? "" })
        continue
      }

      if (msg.role === "tool_result" && msg.toolResult) {
        // Find the tool_call_id from the nearest preceding assistant tool call message
        let toolCallId = `call_0`
        for (let j = i - 1; j >= 0; j--) {
          if (messages[j].role === "assistant" && messages[j].toolCallId) {
            toolCallId = messages[j].toolCallId!
            break
          }
        }

        result.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: JSON.stringify(msg.toolResult.result)
        })
      }
    }

    return result
  }

  private toolToGroq(tool: LLMTool): ChatCompletionTool {
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
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
