import { logger } from "@/config/logger"
import { ResponseError } from "@/errors/response.error"
import { ValidationError } from "@/errors/validation.error"
import { responseErr } from "@/utils/response"
import { NextFunction, Request, Response } from "express"

export const errorMiddleware = (err: Error, req: Request, res: Response, next: NextFunction) => {
  if (!err) {
    next()
    return
  }

  logger.error(err.stack)

  if (err instanceof ValidationError) {
    // Pastikan format response konsisten
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