import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';
import { Request } from 'express';
import { ResponseError } from '@/core/errors/ResponseError';
import { validationsStrings } from '@/core/constants/validations';

const uploadDir = 'public/uploads/images/products';
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.memoryStorage()

const fileFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', ".webp"].includes(ext)) {
    return cb(new ResponseError(400, validationsStrings.product.invalidImageFile));
  }
  cb(null, true);
};

const uploadProductImage = multer({ storage, fileFilter });

export default uploadProductImage;
