import { ValidationErrorItem } from "@/core/errors/ValidationError"
import { Pagination } from "@/core/types/pagination.types"
import { Response } from "express"

const responseOk = (res: Response, status: number, data: unknown, page?: Pagination) => {
  if (!page) {
    return res.status(status).json({ data }).end()
  }
  return res.status(status).json({
    data,
    page: {
      size: page.size,
      total: page.total,
      totalPages: page.totalPages,
      current: page.current
    }
  }).end()
}

const responseErr = (res: Response, status: number, error: { message: string, errors?: ValidationErrorItem[] }) => {
  return res.status(status).json({ error }).end();
}

export { responseOk, responseErr };
