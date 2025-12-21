import { getDb } from "@/config/mongodb"
import { Product } from "@/interfaces/products.interface"

export const productModel = () => {
  return getDb().collection<Product>("products")
}