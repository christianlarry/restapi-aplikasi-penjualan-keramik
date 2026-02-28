import { validationsStrings } from "@/core/constants/validations";
import { z } from "zod"

export const registerUserValidation = z.object({
  firstName: z.string().min(1, { message: validationsStrings.user.firstNameRequired }),
  lastName: z.string().min(1, { message: validationsStrings.user.lastNameRequired }),
  username: z.string()
    .min(3, { message: validationsStrings.user.usernameTooShort })
    .max(20, { message: validationsStrings.user.usernameTooLong }),
  password: z.string()
    .min(6, { message: validationsStrings.user.passwordTooShort }),
  role: z.enum(["admin", "user"], {
    message: validationsStrings.user.roleInvalid
  })
});

export const loginUserValidation = z.object({
  username: z.string()
    .min(3, { message: validationsStrings.user.usernameTooShort })
    .max(20, { message: validationsStrings.user.usernameTooLong }),
  password: z.string()
    .min(6, { message: validationsStrings.user.passwordTooShort })
});

export type RegisterUserRequest = z.infer<typeof registerUserValidation>
export type LoginUserRequest = z.infer<typeof loginUserValidation>
