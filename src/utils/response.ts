import { ValidationErrorItem } from "@/errors/validation.error"
import { Pagination } from "@/interfaces/pagination.interface"
import { Response } from "express"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const responseOk = (res: Response, status: number, data: any, page?: Pagination) => {
  if (!page) {
    return res.status(status).json({
      data
    }).end()
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
  return res.status(status).json({
    error,
  }).end();
}

export {
  responseOk,
  responseErr
};