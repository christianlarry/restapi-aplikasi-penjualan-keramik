import { getDb } from "@/core/config/mongodb";
import { ObjectId, Filter, Document } from "mongodb";
import { Product, ProductFilterOptions } from "./product.types";

const collection = () => getDb().collection<Product>("products");
const filterOptionsCollection = () => getDb().collection<ProductFilterOptions>("product_filter_options");

// --- Product CRUD ---

const findAll = async (): Promise<Product[]> => {
  return collection().find().toArray() as Promise<Product[]>;
};

const aggregate = async (pipeline: Document[]): Promise<Product[]> => {
  return collection().aggregate(pipeline).toArray() as Promise<Product[]>;
};

const findById = async (id: ObjectId): Promise<Product | null> => {
  return collection().findOne({ _id: id });
};

const findOne = async (filter: Filter<Product>): Promise<Product | null> => {
  return collection().findOne(filter);
};

const insertOne = async (data: Omit<Product, "_id">): Promise<Product | null> => {
  const result = await collection().insertOne(data as Product);
  return collection().findOne({ _id: result.insertedId });
};

const findOneAndUpdate = async (
  id: ObjectId,
  update: Partial<Product>
): Promise<Product | null> => {
  return collection().findOneAndUpdate(
    { _id: id },
    { $set: update },
    { returnDocument: "after" }
  );
};

const findOneAndDelete = async (id: ObjectId): Promise<Product | null> => {
  return collection().findOneAndDelete({ _id: id });
};

const countDocuments = async (filter: Filter<Product>): Promise<number> => {
  return collection().countDocuments(filter);
};

const distinct = async (field: string): Promise<string[]> => {
  return collection().distinct(field) as Promise<string[]>;
};

// --- Product Filter Options ---

const findAllFilterOptions = async (): Promise<ProductFilterOptions[]> => {
  return filterOptionsCollection().find().toArray();
};

const upsertFilterOption = async (type: string, options: { label: string; value: string }[]) => {
  return filterOptionsCollection().updateOne(
    { type },
    { $set: { options } },
    { upsert: true }
  );
};

// --- Update Image ---

const updateImage = async (id: ObjectId, image: string, updatedAt: Date) => {
  return collection().updateOne(
    { _id: id },
    { $set: { image, updatedAt } }
  );
};

export const productRepository = {
  findAll,
  aggregate,
  findById,
  findOne,
  findOneAndUpdate,
  findOneAndDelete,
  insertOne,
  countDocuments,
  distinct,
  findAllFilterOptions,
  upsertFilterOption,
  updateImage,
};
