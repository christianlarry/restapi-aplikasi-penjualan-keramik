import { genAI } from "@/core/config/gemini"
import { Content, FunctionDeclaration, GenerateContentConfig, Type } from "@google/genai"
import { logger } from "@/core/config/logger"
import type { ILLMService, LLMMessage, LLMSingleTurnResult, LLMTool, LLMToolPropertySchema } from "@/core/types/llm.types"

export class GeminiLLMService implements ILLMService {
  constructor(private readonly model: string) { }

  async chat(
    messages: LLMMessage[],
    systemPrompt: string,
    tools: LLMTool[] = []
  ): Promise<LLMSingleTurnResult> {
    const contents = this.messagesToContents(messages)

    const config: GenerateContentConfig = {
      systemInstruction: { role: "system", parts: [{ text: systemPrompt }] }
    }

    if (tools.length > 0) {
      config.tools = [{ functionDeclarations: tools.map(t => this.toolToFunctionDeclaration(t)) }]
    }

    const response = await genAI.models.generateContent({
      model: this.model,
      contents,
      config
    })

    // ── Tool call response ──
    if (response.functionCalls && response.functionCalls.length > 0) {
      const call = response.functionCalls[0]
      const toolCall = {
        name: call.name!,
        arguments: (call.args ?? {}) as Record<string, unknown>
      }

      logger.info(`[Gemini] Tool call: ${toolCall.name}\n${JSON.stringify(toolCall.arguments)}`)

      return {
        toolCall,
        rawMessage: { role: "assistant", toolCall }
      }
    }

    // ── Text response ──
    return {
      text: response.text,
      rawMessage: { role: "assistant", text: response.text }
    }
  }

  // ─── Converters ──────────────────────────────────────────────────────────────

  private messagesToContents(messages: LLMMessage[]): Content[] {
    return messages.map(msg => {
      if (msg.role === "user" && msg.text !== undefined) {
        return { role: "user", parts: [{ text: msg.text }] }
      }
      if (msg.role === "assistant" && msg.toolCall) {
        return {
          role: "model",
          parts: [{ functionCall: { name: msg.toolCall.name, args: msg.toolCall.arguments } }]
        }
      }
      if (msg.role === "assistant" && msg.text !== undefined) {
        return { role: "model", parts: [{ text: msg.text }] }
      }
      if (msg.role === "tool_result" && msg.toolResult) {
        return {
          role: "user",
          parts: [{
            functionResponse: {
              name: msg.toolResult.name,
              response: msg.toolResult.result as Record<string, object>
            }
          }]
        }
      }
      // Fallback — should not happen in normal flow
      return { role: "user", parts: [{ text: msg.text ?? "" }] }
    })
  }

  private toolToFunctionDeclaration(tool: LLMTool): FunctionDeclaration {
    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: Type.OBJECT,
        properties: Object.fromEntries(
          Object.entries(tool.parameters.properties).map(([k, v]) => [k, this.convertSchema(v)])
        )
      }
    } as FunctionDeclaration
  }

  private convertSchema(prop: LLMToolPropertySchema): object {
    const typeMap: Record<string, Type> = {
      string: Type.STRING,
      number: Type.NUMBER,
      boolean: Type.BOOLEAN,
      object: Type.OBJECT,
      array: Type.ARRAY
    }

    const schema: Record<string, unknown> = { type: typeMap[prop.type] }
    if (prop.description) schema.description = prop.description
    if (prop.enum) schema.enum = prop.enum
    if (prop.items) schema.items = this.convertSchema(prop.items)
    if (prop.properties) {
      schema.properties = Object.fromEntries(
        Object.entries(prop.properties).map(([k, v]) => [k, this.convertSchema(v)])
      )
    }
    return schema
  }
}
