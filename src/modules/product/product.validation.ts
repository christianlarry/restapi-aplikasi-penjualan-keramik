import { validationsStrings } from "@/core/constants/validations"
import { capitalize } from "@/core/utils/stringFormatter"
import { z } from "zod"

export const postProductValidation = z.object({
  name: z.string().min(1, validationsStrings.product.nameRequired),
  description: z.string().optional(),
  application: z.array(z.string().transform(val => capitalize(val))).min(1, validationsStrings.product.applicationRequired),
  design: z.string().min(1, validationsStrings.product.designRequired).transform(val => capitalize(val)),
  sizeWidth: z.number().positive(validationsStrings.product.sizeWidthPositive),
  sizeHeight: z.number().positive(validationsStrings.product.sizeHeightPositive),
  color: z.array(z.string().transform(val => capitalize(val))).min(1, validationsStrings.product.colorRequired),
  finishing: z.string().min(1, validationsStrings.product.finishingRequired).transform(val => capitalize(val)),
  texture: z.string().min(1, validationsStrings.product.textureRequired).transform(val => capitalize(val)),
  brand: z.string().min(1, validationsStrings.product.brandRequired).transform(val => capitalize(val)),
  price: z.number().nonnegative(validationsStrings.product.priceNonNegative),
  tilesPerBox: z.number().nonnegative(validationsStrings.product.tilesPerBoxNonNegative),
  discount: z.number().nonnegative(validationsStrings.product.discountNonNegative).min(0).max(100).optional(),
  isSlipResistant: z.boolean(),
  isWaterResistant: z.boolean(),
  isBestSeller: z.boolean().optional(),
  isNewArrivals: z.boolean().optional(),
  recommended: z.array(z.string().transform(val => capitalize(val))).optional()
})

export const putProductValidation = postProductValidation

export const promptValidation = z.string().min(1, validationsStrings.product.promptRequired)

export type PostProduct = z.infer<typeof postProductValidation>
export type PutProduct = z.infer<typeof putProductValidation>
