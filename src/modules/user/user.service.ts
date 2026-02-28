import { messages } from "@/core/constants/messages"
import { ValidationError } from "@/core/errors/ValidationError"
import { env } from "@/core/config/env"
import { UserJwtPayload } from "./user.types"
import { userRepository } from "./user.repository"
import { RegisterUserRequest, LoginUserRequest } from "./user.validation"
import bcrypt from "bcrypt"
import jwt from "jsonwebtoken"

const register = async (body: RegisterUserRequest) => {
  // Business rule: unique username
  if (await userRepository.existsByUsername(body.username)) {
    throw new ValidationError([{ field: "username", message: messages.user.usernameExist }]);
  }

  const hashedPassword = await bcrypt.hash(body.password, 10);

  const result = await userRepository.insertOne({
    firstName: body.firstName,
    lastName: body.lastName,
    username: body.username,
    password: hashedPassword,
    role: body.role,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  return {
    _id: result.insertedId,
    ...body
  };
};

const login = async (body: LoginUserRequest) => {
  const user = await userRepository.findByUsername(body.username);
  if (!user) throw new ValidationError([{ field: "username", message: messages.user.notFound }]);

  const isValidPassword = await bcrypt.compare(body.password, user.password);
  if (!isValidPassword) throw new ValidationError([{ field: "password", message: messages.user.wrongPassword }]);

  const payload: UserJwtPayload = {
    _id: user._id!,
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    role: user.role
  };

  const token = jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRATION_MINUTE * 60
  });

  return { token };
};

export default {
  register,
  login
};
