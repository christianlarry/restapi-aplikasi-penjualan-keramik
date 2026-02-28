import { NextFunction, Request, Response } from "express"
import userService from "./user.service"
import { responseOk } from "@/core/utils/response"
import { validate } from "@/core/utils/validate"
import {
  RegisterUserRequest,
  LoginUserRequest,
  registerUserValidation,
  loginUserValidation
} from "./user.validation"

const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validation at controller layer
    const body = validate<RegisterUserRequest>(registerUserValidation, req.body);
    const result = await userService.register(body);
    responseOk(res, 201, result);
  } catch (err) {
    next(err);
  }
};

const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validation at controller layer
    const body = validate<LoginUserRequest>(loginUserValidation, req.body);
    const result = await userService.login(body);
    responseOk(res, 200, result);
  } catch (err) {
    next(err);
  }
};

export default {
  register,
  login
};
