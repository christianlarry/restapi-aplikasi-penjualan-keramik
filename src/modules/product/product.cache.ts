import * as cache from "@/core/utils/cache";

// --- Key Factories ---
export const ProductCacheKeys = {
  byId: (id: string) => `product:id:${id}`,
  list: (params: object) => `products:list:${JSON.stringify(params)}`,
  paginated: (params: object) => `products:paginated:${JSON.stringify(params)}`,
  filterOptions: () => `product:filter_options`,
  allListPattern: () => `products:list:*`,
  allPaginatedPattern: () => `products:paginated:*`,
};

// --- Invalidation Helper ---
export const invalidateProductCaches = async (id?: string) => {
  const tasks: Promise<void>[] = [
    cache.del(ProductCacheKeys.filterOptions()),
    cache.clearKeys(ProductCacheKeys.allListPattern()),
    cache.clearKeys(ProductCacheKeys.allPaginatedPattern()),
  ];

  if (id) {
    tasks.push(cache.del(ProductCacheKeys.byId(id)));
  }

  await Promise.all(tasks);
};
