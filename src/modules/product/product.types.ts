import { ObjectId } from "mongodb"

export interface Product {
  _id?: ObjectId,
  name: string,
  description?: string,
  specification: {
    size: {
      width: number,
      height: number
    },
    application: string[],
    design: string,
    color: string[],
    finishing: string,
    texture: string,
    isWaterResistant: boolean,
    isSlipResistant: boolean,
  }
  brand: string,
  price: number,
  discount?: number,
  tilesPerBox: number,
  isBestSeller?: boolean,
  isNewArrivals?: boolean,
  image?: string,
  recommended?: string[],
  createdAt: Date,
  updatedAt: Date
}

export interface GetProductResponse extends Product {
  finalPrice: number
}

export interface ProductFilters {
  design?: string[],
  texture?: string[],
  finishing?: string[],
  color?: string[],
  application?: string[],
  size?: {
    width: number,
    height: number
  }[],
  discounted?: boolean,
  bestSeller?: boolean,
  newArrivals?: boolean,
  price?: {
    min?: number,
    max?: number
  },
  recommended?: string[]
}

export type ProductOrderBy = "price_asc" | "price_desc" | "name_asc" | "name_desc"

interface FilterOption {
  label: string,
  value: string
}

export interface ProductFilterOptions {
  _id: ObjectId,
  type: string,
  options: FilterOption[]
}
