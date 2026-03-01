import { logger } from "@/core/config/logger"
import { ResponseError } from "@/core/errors/ResponseError"
import { ValidationError } from "@/core/errors/ValidationError"
import { responseErr } from "@/core/utils/response"
import { ApiError } from "@google/genai"
import { NextFunction, Request, Response } from "express"

export const errorMiddleware = (err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (!err) {
    next()
    return
  }

  logger.error(err.stack)

  if (err instanceof ApiError) {
    if (err.status === 429) {
      responseErr(res, 429, { message: "Too many requests. Please try again later." })
    } else {
      responseErr(res, err.status, { message: err.message })
    }
  }

  if (err instanceof ValidationError) {
    responseErr(res, err.status, {
      message: err.message,
      errors: err.errors
    })
  } else if (err instanceof ResponseError) {
    responseErr(res, err.status, { message: err.message })
  } else {
    responseErr(res, 500, { message: err.message })
  }
}
