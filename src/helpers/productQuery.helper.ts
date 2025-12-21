import { Product, ProductFilters, ProductOrderBy } from "@/interfaces/products.interface";
import { Filter } from "mongodb";

export const getProductFilters = (filters: ProductFilters, searchQuery?: string): Filter<Product> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let orArr: any[] = [];

  if (filters.size && filters.size.length > 0) {
    orArr = orArr.concat(filters.size.map(size => ({
      "specification.size.width": size.width,
      "specification.size.height": size.height
    })));
  }

  if (searchQuery) {
    const searchRegex = { $regex: searchQuery, $options: "i" };
    orArr = orArr.concat([
      { "specification.design": searchRegex },
      { "specification.texture": searchRegex },
      { "specification.color": searchRegex },
      { "specification.finishing": searchRegex },
      { name: searchRegex },
      { brand: searchRegex },
      { description: searchRegex },
      { recommended: searchRegex }
    ]);
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