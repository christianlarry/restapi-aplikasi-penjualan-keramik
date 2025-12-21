import { messages } from "@/constants/messages.strings";
import { validationsStrings } from "@/constants/validations.strings";
import { ResponseError } from "@/errors/response.error";
import { ValidationError } from "@/errors/validation.error";
import { getProductFilters, getSortStage } from "@/helpers/productQuery.helper";
import { Pagination } from "@/interfaces/pagination.interface";
import { GetProductResponse, Product, ProductFilterOptions, ProductFilters, ProductOrderBy } from "@/interfaces/products.interface";
import { productModel } from "@/models/product.model";
import { checkValidObjectId } from "@/utils/checkValidObjectId";
import { deleteFile } from "@/utils/deleteFile";
import { PostProduct, postProductValidation, PutProduct, putProductValidation } from "@/validations/product.validation";
import { validate } from "@/validations/validation";
import { db } from "@application/database";
import { ObjectId } from "mongodb";
import productVectorService from "./productVector.service";
import recommendationService from "./recommendation.service";

// --- HELPERS & UTILITIES ---

const getProductFilterOptionsCollection = () => {
  return db.collection<ProductFilterOptions>("product_filter_options");
};

const checkProductName = async (productName: string): Promise<boolean> => {
  const existing = await productModel().findOne({ name: productName });
  return !!existing;
};

const checkUpdatingProductName = async (productId: string, productName: string): Promise<boolean> => {
  const existing = await productModel().findOne({ name: productName, _id: { $ne: new ObjectId(productId) } });
  return !!existing;
};

const updateFilterOptionsFromProduct = async () => {
  const distinctFields = {
    design: await productModel().distinct("specification.design"),
    application: await productModel().distinct("specification.application"),
    texture: await productModel().distinct("specification.texture"),
    finishing: await productModel().distinct("specification.finishing"),
    color: await productModel().distinct("specification.color"),
    size: await productModel().distinct("specification.size"),
  };

  const filtersToCheck = [
    { type: "design", options: distinctFields.design },
    { type: "texture", options: distinctFields.texture },
    { type: "color", options: distinctFields.color },
    { type: "finishing", options: distinctFields.finishing },
    { type: "application", options: distinctFields.application },
    { type: "size", options: distinctFields.size.map(val => `${val.width}x${val.height}`) }
  ];

  for (const filter of filtersToCheck) {
    await getProductFilterOptionsCollection().updateOne(
      { type: filter.type },
      { $set: { options: filter.options.map(val => ({ label: val, value: val })) } },
      { upsert: true }
    );
  }
};

const convertProductToResponseObj = (product: Product): GetProductResponse => {
  return {
    ...product,
    finalPrice: product.discount ? product.price - (product.price * product.discount / 100) : product.price
  };
};

// --- CORE SERVICE FUNCTIONS ---

const getMany = async (searchQuery: string | undefined, filters: ProductFilters, orderBy?: ProductOrderBy, limit?: number) => {

  let products:Product[] = []

  if(!searchQuery && Object.values(filters).every(val => (Array.isArray(val) ? val.length === 0 : typeof val === 'boolean' ? val === false : val === undefined)) && !orderBy && !limit){ 

    products = await productModel().find().toArray() as Product[];

  }else{
    const pipeline: any[] = [
      { $match: getProductFilters(filters, searchQuery) },
      { $addFields: { finalPrice: { $subtract: ["$price", { $divide: [{ $multiply: ["$price", { $ifNull: ["$discount", 0] }] }, 100] }] } } },
      getSortStage(orderBy),
      limit ? { $limit: limit } : {}
    ];
  
    products = await productModel().aggregate(pipeline).toArray() as Product[];
  }
  
  return products.map(item => convertProductToResponseObj(item));

};

const getPaginated = async (page: number, size: number, searchQuery: string | undefined, filters: ProductFilters, orderBy?: ProductOrderBy) => {
  const filterQuery = getProductFilters(filters, searchQuery);

  const pipeline: any[] = [
    { $match: filterQuery },
    { $addFields: { finalPrice: { $subtract: ["$price", { $divide: [{ $multiply: ["$price", { $ifNull: ["$discount", 0] }] }, 100] }] } } },
    getSortStage(orderBy),
    { $skip: (page - 1) * size },
    { $limit: size }
  ];

  const products = await productModel().aggregate(pipeline).toArray();
  const total = await productModel().countDocuments(filterQuery);
  const totalPages = Math.ceil(total / size);

  const pagination: Pagination = { total, size, totalPages, current: page };

  return {
    product: products.map(item => convertProductToResponseObj(item as Product)),
    pagination
  };
};

const get = async (id: string) => {
  checkValidObjectId(id, messages.product.invalidId);
  const product: Product | null = await productModel().findOne({ _id: new ObjectId(id) });
  if (!product) throw new ResponseError(404, messages.product.notFound);
  return convertProductToResponseObj(product);
};

const getProductFilterOptions = async () => {
  return await getProductFilterOptionsCollection().find().toArray();
};

const create = async (body: PostProduct) => {
  const product = validate<PostProduct>(postProductValidation, body);

  if (await checkProductName(product.name)) {
    throw new ValidationError([{ field: "name", message: messages.product.nameTaken }]);
  }

  const newProductDocument: Omit<Product, '_id'> = {
    name: product.name,
    ...(product.description && { description: product.description }),
    specification: {
      application: product.application,
      color: product.color,
      design: product.design,
      finishing: product.finishing,
      texture: product.texture,
      size: { height: product.sizeHeight, width: product.sizeWidth },
      isSlipResistant: product.isSlipResistant,
      isWaterResistant: product.isWaterResistant
    },
    brand: product.brand,
    price: product.price,
    tilesPerBox: product.tilesPerBox,
    ...(product.discount && { discount: product.discount }),
    isBestSeller: product.isBestSeller || false,
    isNewArrivals: product.isNewArrivals || false,
    ...(product.recommended && { recommended: product.recommended }),
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const result = await productModel().insertOne(newProductDocument);
  const newProduct = await productModel().findOne({ _id: result.insertedId });

  if (newProduct) {
    await updateFilterOptionsFromProduct();
    // await productVectorService.upsert(newProduct);
  }

  return newProduct;
};

const update = async (id: string, body: PutProduct) => {
  const product = validate<PutProduct>(putProductValidation, body);
  checkValidObjectId(id, messages.product.invalidId);

  if (await checkUpdatingProductName(id, product.name)) {
    throw new ValidationError([{ field: "name", message: messages.product.nameTaken }]);
  }

  const updateData = {
    name: product.name,
    ...(product.description && { description: product.description }),
    ...(product.recommended && { recommended: product.recommended }),
    specification: {
      isSlipResistant: product.isSlipResistant,
      isWaterResistant: product.isWaterResistant,
      application: product.application,
      design: product.design,
      color: product.color,
      finishing: product.finishing,
      texture: product.texture,
      size: { height: product.sizeHeight, width: product.sizeWidth },
    },
    brand: product.brand,
    price: product.price,
    tilesPerBox: product.tilesPerBox,
    ...(product.discount && { discount: product.discount }),
    ...(typeof product.isBestSeller !== 'undefined' && { isBestSeller: product.isBestSeller }),
    ...(typeof product.isNewArrivals !== 'undefined' && { isNewArrivals: product.isNewArrivals }),
    updatedAt: new Date()
  };

  const result = await productModel().findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set: updateData },
    { returnDocument: "after" }
  );

  if (!result) throw new ResponseError(404, messages.product.notFound);

  await updateFilterOptionsFromProduct();
  // await productVectorService.update(result);

  return convertProductToResponseObj(result);
};

const updateProductFlags = async (productId: string, flags: { isBestSeller?: boolean; isNewArrivals?: boolean }) => {
  checkValidObjectId(productId, messages.product.invalidId);
  const updateFields: any = {};
  if (typeof flags.isBestSeller !== "undefined") updateFields.isBestSeller = flags.isBestSeller;
  if (typeof flags.isNewArrivals !== "undefined") updateFields.isNewArrivals = flags.isNewArrivals;

  if (Object.keys(updateFields).length === 0) {
    throw new ValidationError([{ field: "flags", message: "No valid flag fields provided" }]);
  }

  const result = await productModel().findOneAndUpdate(
    { _id: new ObjectId(productId) },
    { $set: updateFields },
    { returnDocument: "after" }
  );

  if (!result) throw new ResponseError(404, messages.product.notFound);
  return convertProductToResponseObj(result);
};

const updateProductDiscount = async (productId: string, discount: number) => {
  checkValidObjectId(productId, messages.product.invalidId);
  if (discount < 0 || discount > 100) {
    throw new ValidationError([{ field: "discount", message: validationsStrings.product.discountMustBeBetween0And100 }]);
  }

  const result = await productModel().findOneAndUpdate(
    { _id: new ObjectId(productId) },
    { $set: { discount } },
    { returnDocument: "after" }
  );

  if (!result) throw new ResponseError(404, messages.product.notFound);
  return convertProductToResponseObj(result);
};

const remove = async (id: string) => {
  checkValidObjectId(id, messages.product.invalidId);
  const result = await productModel().findOneAndDelete({ _id: new ObjectId(id) });

  if (!result) throw new ResponseError(404, messages.product.notFound);

  if (result.image) deleteFile("public\\" + result.image);
  await updateFilterOptionsFromProduct();
  // await productVectorService.remove(id);

  return result;
};

const getProductRecommendationsByAI = async (prompt: string) => {
  return recommendationService.getRecommendations(prompt);
};

const getDistinctValues = async (field: keyof Product | "specification.design" | "specification.texture" | "specification.finishing" | "specification.color" | "specification.application" | "specification.size")=>{
  const distinctFields = await productModel().distinct(field)

  return distinctFields
}

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
  getProductRecommendationsByAI,
  getDistinctValues
};