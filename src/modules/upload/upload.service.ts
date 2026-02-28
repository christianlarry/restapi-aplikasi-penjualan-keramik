import { ObjectId } from "mongodb"
import { ResponseError } from "@/core/errors/ResponseError"
import { checkValidObjectId } from "@/core/utils/checkValidObjectId"
import { messages } from "@/core/constants/messages"
import { deleteFile } from "@/core/utils/deleteFile"
import { logger } from "@/core/config/logger"
import { productRepository } from "@/modules/product/product.repository"
import path from "path"
import sharp from "sharp"

const uploadProductImage = async (
  productId: string,
  file: Express.Multer.File
) => {
  checkValidObjectId(productId, messages.product.invalidId)

  const productObjectId = new ObjectId(productId)
  const product = await productRepository.findById(productObjectId)

  if (!product) throw new ResponseError(404, messages.product.notFound)

  // Delete previous image if exists
  if (product.image) deleteFile("public\\" + product.image)

  const dateNow = new Date()
  const fileName = `${product.name.split(" ").join("-")}-${dateNow.getTime()}.webp`.toLowerCase()
  const fileDestination = "public//uploads/images/products"
  const filePath = path.join(fileDestination, fileName)

  try {
    await sharp(file.buffer)
      .resize(800, 800, { fit: "cover" })
      .webp({ quality: 80 })
      .toFile(filePath)
  } catch (err) {
    logger.error("Error processing image upload: %O", err)
    throw new ResponseError(500, "Failed to process image")
  }

  const result = await productRepository.updateImage(
    productObjectId,
    filePath.replace(`public\\`, ""),
    dateNow
  )

  if (result.modifiedCount === 0) {
    throw new ResponseError(500, messages.product.errorProductNotUpdated)
  }

  const updatedProduct = await productRepository.findById(productObjectId)
  if (!updatedProduct) {
    throw new ResponseError(500, messages.product.errorProductNotFoundAfterUpdate)
  }

  return updatedProduct
}

export default {
  uploadProductImage
}
