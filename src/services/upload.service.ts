import { ObjectId } from "mongodb"
import { Product } from "@/interfaces/products.interface"
import { ResponseError } from "@/errors/response.error"
import { checkValidObjectId } from "@/utils/checkValidObjectId"
import { messages } from "@/constants/messages.strings"
import { deleteFile } from "@/utils/deleteFile"
import path from "path"
import { productModel } from "@/models/product.model"
import sharp from "sharp"
import { logger } from "@/config/logger"

const uploadProductImage = async (
  productId: string,
  file: Express.Multer.File
) => {
  // Cek apakah valid product Id
  checkValidObjectId(productId, messages.product.invalidId)

  const productObjectId = new ObjectId(productId)

  // Cek apakah product ada atau tidak!
  const product: Product | null = await productModel().findOne({
    _id: productObjectId
  })

  if (!product) throw new ResponseError(404, messages.product.notFound)

  // Hapus image sebelumnnya jika ada
  if (product.image) deleteFile("public\\" + product.image)

  // Ganti nama file
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

  // Update field image and meta updatedAt
  const result = await productModel().updateOne({
    _id: productObjectId
  }, {
    $set: {
      image: filePath.replace(`public\\`, ""),
      updatedAt: dateNow
    }
  })


  if (result.modifiedCount === 0) {
    throw new ResponseError(500, messages.product.errorProductNotUpdated);
  }

  // Kembalikan data produk baru
  const updatedProduct = await productModel().findOne({ _id: productObjectId });
  if (!updatedProduct) {
    throw new ResponseError(500, messages.product.errorProductNotFoundAfterUpdate);
  }

  return updatedProduct;
}

export default {
  uploadProductImage
}