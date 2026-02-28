import { ResponseError } from "@/core/errors/ResponseError"
import { UserJwtPayload } from "@/modules/user/user.types"
import { userRepository } from "@/modules/user/user.repository"
import { env } from "@/core/config/env"
import { NextFunction, Request, Response } from "express"
import jwt from "jsonwebtoken"

export interface WithUserRequest extends Request {
  user?: UserJwtPayload
}

export const authenticateToken = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1]

    if (!token) throw new ResponseError(401, "Unauthorized")

    const decoded = jwt.verify(token, env.JWT_SECRET)

    const isUserExist = await userRepository.existsByUsername((decoded as UserJwtPayload).username)
    if (!isUserExist) {
      throw new ResponseError(403, "Forbidden")
    }

    (req as WithUserRequest).user = decoded as UserJwtPayload

    next()
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError || err instanceof jwt.NotBeforeError) {
      next(new ResponseError(403, "Forbidden"))
    } else {
      next(err)
    }
  }
}
