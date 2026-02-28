import { Router } from "express"
import { apiGenAIRateLimiter } from "@/core/middlewares/rateLimiter.middleware"
import chatController from "./chat.controller"

const router = Router()

// POST /api/recommendations — start new or continue existing chat
router.post("/", apiGenAIRateLimiter, chatController.chat)

// GET /api/recommendations/:sessionId/history — retrieve session history
router.get("/:sessionId/history", chatController.getHistory)

// DELETE /api/recommendations/:sessionId — delete session
router.delete("/:sessionId", chatController.deleteSession)

export default router
