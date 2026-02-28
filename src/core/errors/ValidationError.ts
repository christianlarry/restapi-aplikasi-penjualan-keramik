import { ResponseError } from "./ResponseError";

export interface ValidationErrorItem {
  field: string;
  message: string;
}

export class ValidationError extends ResponseError {
  public errors: ValidationErrorItem[];

  constructor(errors: ValidationErrorItem[]) {
    super(400, "Validation Error");
    this.errors = errors;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}
