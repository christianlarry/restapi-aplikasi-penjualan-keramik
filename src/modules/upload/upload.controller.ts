import { NextFunction, Request, Response } from "express"
import uploadService from "./upload.service";
import { responseOk } from "@/core/utils/response";
import { ResponseError } from "@/core/errors/ResponseError";
import { validationsStrings } from "@/core/constants/validations";
import { deleteFile } from "@/core/utils/deleteFile";

const uploadProductImage = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { productId } = req.body

    if (!productId) throw new ResponseError(400, validationsStrings.product.idRequired)
    if (!req.file) throw new ResponseError(400, validationsStrings.product.imageFileRequired)

    const updatedProduct = await uploadService.uploadProductImage(productId, req.file)

    responseOk(res, 201, updatedProduct)
  } catch (err) {
    if (req.file) {
      deleteFile(req.file.path)
    }
    next(err)
  }
}

export default {
  uploadProductImage
}
