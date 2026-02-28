import { Product, ProductFilters, ProductOrderBy } from "./product.types";
import { Filter } from "mongodb";

export const getProductFilters = (filters: ProductFilters, searchQuery?: string): Filter<Product> => {
  const orArr: Filter<Product>[] = [];

  if (filters.size && filters.size.length > 0) {
    for (const size of filters.size) {
      orArr.push({
        "specification.size.width": size.width,
        "specification.size.height": size.height
      } as Filter<Product>);
    }
  }

  if (searchQuery) {
    const searchRegex = { $regex: searchQuery, $options: "i" };
    orArr.push(
      { "specification.design": searchRegex } as Filter<Product>,
      { "specification.texture": searchRegex } as Filter<Product>,
      { "specification.color": searchRegex } as Filter<Product>,
      { "specification.finishing": searchRegex } as Filter<Product>,
      { name: searchRegex } as Filter<Product>,
      { brand: searchRegex } as Filter<Product>,
      { description: searchRegex } as Filter<Product>,
      { recommended: searchRegex } as Filter<Product>
    );
  }

  const filterQuery: Filter<Product> = {
    ...(filters.design && { "specification.design": { $in: filters.design } }),
    ...(filters.texture && { "specification.texture": { $in: filters.texture } }),
    ...(filters.color && { "specification.color": { $in: filters.color } }),
    ...(filters.finishing && { "specification.finishing": { $in: filters.finishing } }),
    ...(filters.application && { "specification.application": { $in: filters.application } }),
    ...(filters.discounted && { discount: { $gt: 0 } }),
    ...(filters.bestSeller && { isBestSeller: true }),
    ...(filters.newArrivals && { isNewArrivals: true }),
    ...(filters.price && { price: { $gte: filters.price.min ?? 0, $lte: filters.price.max ?? 999999999999 } }),
    ...(filters.recommended && { recommended: { $in: filters.recommended } })
  };

  if (orArr.length > 0) {
    filterQuery.$or = orArr;
  }

  return filterQuery;
};

export const getSortStage = (orderBy: ProductOrderBy | undefined) => {
  switch (orderBy) {
    case "price_asc":
      return { $sort: { finalPrice: 1 } };
    case "price_desc":
      return { $sort: { finalPrice: -1 } };
    case "name_asc":
      return { $sort: { name: 1 } };
    case "name_desc":
      return { $sort: { name: -1 } };
    default:
      return { $sort: { createdAt: -1 } };
  }
};
