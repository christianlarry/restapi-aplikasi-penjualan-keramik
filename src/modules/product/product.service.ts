import { messages } from "@/core/constants/messages";
import { validationsStrings } from "@/core/constants/validations";
import { ResponseError } from "@/core/errors/ResponseError";
import { ValidationError } from "@/core/errors/ValidationError";
import { Pagination } from "@/core/types/pagination.types";
import * as cache from "@/core/utils/cache";
import { checkValidObjectId } from "@/core/utils/checkValidObjectId";
import { deleteFile } from "@/core/utils/deleteFile";
import { ObjectId, Document } from "mongodb";
import elasticsearchService from "@/core/services/elasticsearch/elasticsearch.service";
import { logger } from "@/core/config/logger";

import { productRepository } from "./product.repository";
import { ProductCacheKeys, invalidateProductCaches } from "./product.cache";
import { getProductFilters, getSortStage } from "./product.query";
import { Product, GetProductResponse, ProductFilters, ProductOrderBy } from "./product.types";
import { PostProduct, PutProduct } from "./product.validation";

// --- DTO Transformation ---

const toResponse = (product: Product): GetProductResponse => ({
  ...product,
  finalPrice: product.discount ? product.price - (product.price * product.discount / 100) : product.price
});

// --- Sync Filter Options ---

const syncFilterOptions = async () => {
  const fields = ["design", "application", "texture", "finishing", "color", "size"] as const;

  for (const field of fields) {
    const distinctValues = await productRepository.distinct(`specification.${field}`);

    const options = field === "size"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (distinctValues as any[]).map(val => ({ label: `${val.width}x${val.height}`, value: `${val.width}x${val.height}` }))
      : distinctValues.map(val => ({ label: val, value: val }));

    await productRepository.upsertFilterOption(field, options);
  }
};

// --- Core Service Functions ---

const getMany = async (searchQuery: string | undefined, filters: ProductFilters, orderBy?: ProductOrderBy, limit?: number) => {
  const cacheKey = ProductCacheKeys.list({ searchQuery, filters, orderBy, limit });

  return cache.getOrSet(cacheKey, async () => {
    // ── ES search path (when text search is present) ──
    if (searchQuery) {
      try {
        const { ids } = await elasticsearchService.searchProducts({
          searchQuery, filters, orderBy, size: limit ?? 100
        });

        if (ids.length === 0) return [];

        // Fetch full data from MongoDB (source of truth)
        const products = await productRepository.findByIds(ids.map(id => new ObjectId(id)));

        // Preserve ES relevance order (MongoDB $in doesn't guarantee order)
        const productMap = new Map(products.map(p => [p._id!.toString(), p]));
        return ids
          .map(id => productMap.get(id))
          .filter((p): p is Product => !!p)
          .map(toResponse);

      } catch (err) {
        // Graceful degradation — fall back to MongoDB regex search
        logger.error("[ES] Search failed, falling back to MongoDB:", err);
      }
    }

    // ── MongoDB path (no search text, or ES fallback) ──
    const isEmptyQuery = !searchQuery
      && Object.values(filters).every(val => (Array.isArray(val) ? val.length === 0 : typeof val === 'boolean' ? val === false : val === undefined))
      && !orderBy && !limit;

    let products: Product[];

    if (isEmptyQuery) {
      products = await productRepository.findAll();
    } else {
      const pipeline: Document[] = [
        { $match: getProductFilters(filters, searchQuery) },
        { $addFields: { finalPrice: { $subtract: ["$price", { $divide: [{ $multiply: ["$price", { $ifNull: ["$discount", 0] }] }, 100] }] } } },
        getSortStage(orderBy),
        ...(limit ? [{ $limit: limit }] : [])
      ];
      products = await productRepository.aggregate(pipeline);
    }

    return products.map(toResponse);
  }, 3600);
};

const getPaginated = async (page: number, size: number, searchQuery: string | undefined, filters: ProductFilters, orderBy?: ProductOrderBy) => {
  const cacheKey = ProductCacheKeys.paginated({ page, size, searchQuery, filters, orderBy });

  return cache.getOrSet(cacheKey, async () => {
    // ── ES search path (when text search is present) ──
    if (searchQuery) {
      try {
        const { ids, total } = await elasticsearchService.searchProducts({
          searchQuery, filters, orderBy, page, size
        });

        // Fetch full data from MongoDB
        const products = await productRepository.findByIds(ids.map(id => new ObjectId(id)));

        // Preserve ES relevance order
        const productMap = new Map(products.map(p => [p._id!.toString(), p]));
        const ordered = ids
          .map(id => productMap.get(id))
          .filter((p): p is Product => !!p)
          .map(toResponse);

        const totalPages = Math.ceil(total / size);
        const pagination: Pagination = { total, size, totalPages, current: page };

        return { product: ordered, pagination };
      } catch (err) {
        logger.error("[ES] Paginated search failed, falling back to MongoDB:", err);
      }
    }

    // ── MongoDB path (no search text, or ES fallback) ──
    const filterQuery = getProductFilters(filters, searchQuery);

    const pipeline: Document[] = [
      { $match: filterQuery },
      { $addFields: { finalPrice: { $subtract: ["$price", { $divide: [{ $multiply: ["$price", { $ifNull: ["$discount", 0] }] }, 100] }] } } },
      getSortStage(orderBy),
      { $skip: (page - 1) * size },
      { $limit: size }
    ];

    const products = await productRepository.aggregate(pipeline);
    const total = await productRepository.countDocuments(filterQuery);
    const totalPages = Math.ceil(total / size);

    const pagination: Pagination = { total, size, totalPages, current: page };

    return {
      product: products.map(item => toResponse(item as Product)),
      pagination
    };
  }, 3600);
};

const get = async (id: string) => {
  checkValidObjectId(id, messages.product.invalidId);
  const cacheKey = ProductCacheKeys.byId(id);

  return cache.getOrSet(cacheKey, async () => {
    const product = await productRepository.findById(new ObjectId(id));
    if (!product) throw new ResponseError(404, messages.product.notFound);
    return toResponse(product);
  }, 3600);
};

const getProductFilterOptions = async () => {
  const cacheKey = ProductCacheKeys.filterOptions();

  return cache.getOrSet(cacheKey, async () => {
    return productRepository.findAllFilterOptions();
  }, 3600);
};

const create = async (body: PostProduct) => {
  // Business rule: unique name
  if (await productRepository.findOne({ name: body.name })) {
    throw new ValidationError([{ field: "name", message: messages.product.nameTaken }]);
  }

  const newProductDocument: Omit<Product, '_id'> = {
    name: body.name,
    ...(body.description && { description: body.description }),
    specification: {
      application: body.application,
      color: body.color,
      design: body.design,
      finishing: body.finishing,
      texture: body.texture,
      size: { height: body.sizeHeight, width: body.sizeWidth },
      isSlipResistant: body.isSlipResistant,
      isWaterResistant: body.isWaterResistant
    },
    brand: body.brand,
    price: body.price,
    tilesPerBox: body.tilesPerBox,
    ...(body.discount && { discount: body.discount }),
    isBestSeller: body.isBestSeller || false,
    isNewArrivals: body.isNewArrivals || false,
    ...(body.recommended && { recommended: body.recommended }),
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const newProduct = await productRepository.insertOne(newProductDocument);

  if (newProduct) {
    await syncFilterOptions();
    await invalidateProductCaches();

    // Sync to Elasticsearch (fire-and-forget)
    elasticsearchService.indexProduct(newProduct).catch(err =>
      logger.error("[ES] Failed to index new product:", err)
    );
  }

  return newProduct;
};

const update = async (id: string, body: PutProduct) => {
  checkValidObjectId(id, messages.product.invalidId);

  // Business rule: name uniqueness for other products
  const existing = await productRepository.findOne({ name: body.name, _id: { $ne: new ObjectId(id) } });
  if (existing) {
    throw new ValidationError([{ field: "name", message: messages.product.nameTaken }]);
  }

  const updateData = {
    name: body.name,
    ...(body.description && { description: body.description }),
    ...(body.recommended && { recommended: body.recommended }),
    specification: {
      isSlipResistant: body.isSlipResistant,
      isWaterResistant: body.isWaterResistant,
      application: body.application,
      design: body.design,
      color: body.color,
      finishing: body.finishing,
      texture: body.texture,
      size: { height: body.sizeHeight, width: body.sizeWidth },
    },
    brand: body.brand,
    price: body.price,
    tilesPerBox: body.tilesPerBox,
    ...(body.discount && { discount: body.discount }),
    ...(typeof body.isBestSeller !== 'undefined' && { isBestSeller: body.isBestSeller }),
    ...(typeof body.isNewArrivals !== 'undefined' && { isNewArrivals: body.isNewArrivals }),
    updatedAt: new Date()
  };

  const result = await productRepository.findOneAndUpdate(new ObjectId(id), updateData);
  if (!result) throw new ResponseError(404, messages.product.notFound);

  await syncFilterOptions();
  await invalidateProductCaches(id);

  // Sync to Elasticsearch (fire-and-forget)
  elasticsearchService.updateProduct(result).catch(err =>
    logger.error(`[ES] Failed to update product ${id}:`, err)
  );

  return toResponse(result);
};

const updateProductFlags = async (productId: string, flags: { isBestSeller?: boolean; isNewArrivals?: boolean }) => {
  checkValidObjectId(productId, messages.product.invalidId);

  const updateFields: Partial<Product> = {};
  if (typeof flags.isBestSeller !== "undefined") updateFields.isBestSeller = flags.isBestSeller;
  if (typeof flags.isNewArrivals !== "undefined") updateFields.isNewArrivals = flags.isNewArrivals;

  if (Object.keys(updateFields).length === 0) {
    throw new ValidationError([{ field: "flags", message: "No valid flag fields provided" }]);
  }

  const result = await productRepository.findOneAndUpdate(new ObjectId(productId), updateFields);
  if (!result) throw new ResponseError(404, messages.product.notFound);

  await invalidateProductCaches(productId);

  // Sync to Elasticsearch (fire-and-forget)
  elasticsearchService.updateProduct(result).catch(err =>
    logger.error(`[ES] Failed to update product flags ${productId}:`, err)
  );

  return toResponse(result);
};

const updateProductDiscount = async (productId: string, discount: number) => {
  checkValidObjectId(productId, messages.product.invalidId);
  if (discount < 0 || discount > 100) {
    throw new ValidationError([{ field: "discount", message: validationsStrings.product.discountMustBeBetween0And100 }]);
  }

  const result = await productRepository.findOneAndUpdate(new ObjectId(productId), { discount } as Partial<Product>);
  if (!result) throw new ResponseError(404, messages.product.notFound);

  await invalidateProductCaches(productId);

  // Sync to Elasticsearch (fire-and-forget)
  elasticsearchService.updateProduct(result).catch(err =>
    logger.error(`[ES] Failed to update product discount ${productId}:`, err)
  );

  return toResponse(result);
};

const remove = async (id: string) => {
  checkValidObjectId(id, messages.product.invalidId);
  const result = await productRepository.findOneAndDelete(new ObjectId(id));

  if (!result) throw new ResponseError(404, messages.product.notFound);
  if (result.image) deleteFile("public\\" + result.image);

  await syncFilterOptions();
  await invalidateProductCaches(id);

  // Remove from Elasticsearch (fire-and-forget)
  elasticsearchService.deleteProduct(id).catch(err =>
    logger.error(`[ES] Failed to delete product ${id}:`, err)
  );

  return result;
};

const getDistinctValues = async (field: string) => {
  return productRepository.distinct(field);
};

export default {
  get,
  getPaginated,
  getMany,
  getProductFilterOptions,
  create,
  update,
  updateProductFlags,
  updateProductDiscount,
  remove,
  getDistinctValues
};
