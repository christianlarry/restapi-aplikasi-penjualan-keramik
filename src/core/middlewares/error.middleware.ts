import { logger } from "@/core/config/logger"
import { ResponseError } from "@/core/errors/ResponseError"
import { ValidationError } from "@/core/errors/ValidationError"
import { responseErr } from "@/core/utils/response"
import { NextFunction, Request, Response } from "express"

export const errorMiddleware = (err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (!err) {
    next()
    return
  }

  logger.error(err.stack)

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
