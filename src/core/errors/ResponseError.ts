import { AppError } from "./AppError";

export class ResponseError extends AppError {
  constructor(status: number, message: string) {
    super(status, message);
    Object.setPrototypeOf(this, ResponseError.prototype);
  }
}
