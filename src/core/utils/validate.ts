import { ValidationError, ValidationErrorItem } from "@/core/errors/ValidationError";
import { ZodSchema } from "zod"

export const validate = <T>(schema: ZodSchema, data: unknown): T => {
  const result = schema.safeParse(data);

  if (!result.success) {
    const errors: ValidationErrorItem[] = result.error.errors.map((err) => ({
      field: err.path.join("."),
      message: err.message,
    }));
    throw new ValidationError(errors);
  }

  return result.data as T
}
