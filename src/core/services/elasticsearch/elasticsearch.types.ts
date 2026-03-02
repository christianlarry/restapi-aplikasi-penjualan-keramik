/**
 * Shape of a product document as stored in the Elasticsearch index.
 *
 * This mirrors the MongoDB Product type but:
 * - Uses `mongoId` (string) instead of ObjectId
 * - Dates are ISO-8601 strings
 * - `finalPrice` is pre-computed for sort/filter in ES
 */
export interface ProductESDocument {
  mongoId: string
  name: string
  description?: string
  brand: string
  price: number
  discount?: number
  finalPrice: number
  tilesPerBox: number
  isBestSeller: boolean
  isNewArrivals: boolean
  recommended: string[]
  createdAt: string
  updatedAt: string
  specification: {
    design: string
    texture: string
    finishing: string
    color: string[]
    application: string[]
    isWaterResistant: boolean
    isSlipResistant: boolean
    size: {
      width: number
      height: number
    }
  }
}

/**
 * Parameters accepted by `searchProducts()`.
 */
export interface ESSearchParams {
  searchQuery?: string
  filters?: {
    design?: string[]
    texture?: string[]
    finishing?: string[]
    color?: string[]
    application?: string[]
    size?: { width: number; height: number }[]
    discounted?: boolean
    bestSeller?: boolean
    newArrivals?: boolean
    price?: { min?: number; max?: number }
    recommended?: string[]
  }
  orderBy?: "price_asc" | "price_desc" | "name_asc" | "name_desc"
  page?: number
  size?: number
}

/**
 * Result from `searchProducts()`.
 */
export interface ESSearchResult {
  /** MongoDB _id strings, ordered by relevance / requested sort */
  ids: string[]
  /** Total number of documents matching the query */
  total: number
}
