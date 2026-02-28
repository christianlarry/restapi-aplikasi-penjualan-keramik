import { Request, Response, NextFunction } from "express";

import productService from "./product.service";
import { ProductFilters, ProductOrderBy } from "./product.types";
import { PostProduct, PutProduct, postProductValidation, putProductValidation } from "./product.validation";
import { responseOk } from "@/core/utils/response";
import { validate } from "@/core/utils/validate";
import { FilterQuery, parseQueryArray, parseQuerySizeToArray } from "@/core/utils/queryFormatter";
import geminiService from "@/modules/recommendation/gemini.service";

const fallbackPaginationSize = 10;
const fallbackPaginationPage = 1;

const getMany = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters: ProductFilters = {
      texture: parseQueryArray(req.query.texture as FilterQuery),
      finishing: parseQueryArray(req.query.finishing as FilterQuery),
      color: parseQueryArray(req.query.color as FilterQuery),
      design: parseQueryArray(req.query.design as FilterQuery),
      application: parseQueryArray(req.query.application as FilterQuery),
      size: parseQuerySizeToArray(req.query.size as FilterQuery),
      bestSeller: req.query.bestSeller?.toString() == "true",
      newArrivals: req.query.newArrivals?.toString() == "true",
      discounted: req.query.discounted?.toString() == "true"
    };

    const searchQuery: string | undefined = req.query.search?.toString();
    const orderBy: string | undefined = req.query.order_by?.toString();
    const { pagination_size, pagination_page } = req.query;

    if (pagination_page || pagination_size) {
      const { product, pagination } = await productService.getPaginated(
        parseInt(pagination_page as string) || fallbackPaginationPage,
        parseInt(pagination_size as string) || fallbackPaginationSize,
        searchQuery,
        filters,
        orderBy as ProductOrderBy
      );
      responseOk(res, 200, product, pagination);
      return;
    }

    const products = await productService.getMany(searchQuery, filters, orderBy as ProductOrderBy);
    responseOk(res, 200, products);
  } catch (err) {
    next(err);
  }
};

const get = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const product = await productService.get(req.params.id);
    responseOk(res, 200, product);
  } catch (err) {
    next(err);
  }
};

const getProductFilterOptions = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await productService.getProductFilterOptions();
    responseOk(res, 200, result);
  } catch (err) {
    next(err);
  }
};

const add = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validation at controller layer
    const body = validate<PostProduct>(postProductValidation, req.body);
    const result = await productService.create(body);
    responseOk(res, 201, result);
  } catch (err) {
    next(err);
  }
};

const update = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validation at controller layer
    const body = validate<PutProduct>(putProductValidation, req.body);
    const result = await productService.update(req.params.id, body);
    responseOk(res, 200, result);
  } catch (err) {
    next(err);
  }
};

const updateProductFlags = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { isBestSeller, isNewArrivals } = req.body;
    const result = await productService.updateProductFlags(req.params.id, { isBestSeller, isNewArrivals });
    responseOk(res, 200, result);
  } catch (err) {
    next(err);
  }
};

const updateProductDiscount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { discount } = req.body;
    const result = await productService.updateProductDiscount(req.params.id, discount);
    responseOk(res, 200, result);
  } catch (err) {
    next(err);
  }
};

const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await productService.remove(req.params.id);
    responseOk(res, 200, result);
  } catch (err) {
    next(err);
  }
};

const recommendProducts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { prompt } = req.body;
    const result = await geminiService.getProductRecommendations(prompt);
    responseOk(res, 200, result);
  } catch (err) {
    next(err);
  }
};

export default {
  getMany,
  get,
  getProductFilterOptions,
  add,
  update,
  updateProductFlags,
  updateProductDiscount,
  remove,
  recommendProducts
};
