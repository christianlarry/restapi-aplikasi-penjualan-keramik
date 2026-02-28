import { getDb } from "@/core/config/mongodb";
import { User } from "./user.types";

const collection = () => getDb().collection<User>("users");

const findByUsername = async (username: string): Promise<User | null> => {
  return collection().findOne({ username });
};

const existsByUsername = async (username: string): Promise<boolean> => {
  const user = await collection().findOne({ username });
  return !!user;
};

const insertOne = async (data: Omit<User, "_id">) => {
  return collection().insertOne(data as User);
};

export const userRepository = {
  findByUsername,
  existsByUsername,
  insertOne,
};
