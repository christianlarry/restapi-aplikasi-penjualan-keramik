import { ResponseError } from "@/core/errors/ResponseError";
import { ObjectId } from "mongodb";

export const checkValidObjectId = (id: string, message: string = "Invalid id!") => {
  if (!ObjectId.isValid(id))
    throw new ResponseError(400, message);
}
