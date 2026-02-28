import { Request, Response, NextFunction } from "express"
import chatService from "./chat.service"
import { responseOk } from "@/core/utils/response"
import { ResponseError } from "@/core/errors/ResponseError"

const chat = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { prompt, sessionId } = req.body

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      throw new ResponseError(400, "Prompt is required.")
    }

    const result = await chatService.chat(prompt.trim(), sessionId)
    responseOk(res, 200, result)
  } catch (err) {
    next(err)
  }
}

const getHistory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sessionId } = req.params
    const result = await chatService.getHistory(sessionId)
    responseOk(res, 200, result)
  } catch (err) {
    next(err)
  }
}

const deleteSession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sessionId } = req.params
    await chatService.deleteSession(sessionId)
    responseOk(res, 200, { message: "Session deleted." })
  } catch (err) {
    next(err)
  }
}

export default {
  chat,
  getHistory,
  deleteSession
}
