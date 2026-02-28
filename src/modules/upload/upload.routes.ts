import { Router } from "express";
import { authenticateToken } from "@/core/middlewares/auth.middleware";
import uploadProductImage from "@/core/middlewares/upload.middleware";
import uploadController from "./upload.controller";

const router = Router();

// Private routes (protected)
router.post(
  "/product-image",
  authenticateToken,
  uploadProductImage.single("image"),
  uploadController.uploadProductImage
);

export default router;
