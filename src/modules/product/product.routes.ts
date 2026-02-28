import { Router } from "express";
import { authenticateToken } from "@/core/middlewares/auth.middleware";
import { apiGenAIRateLimiter } from "@/core/middlewares/rateLimiter.middleware";
import productController from "./product.controller";

const router = Router();

// Public routes
router.get("/", productController.getMany);
router.get("/filter-options", productController.getProductFilterOptions);
router.get("/:id", productController.get);
router.post("/recommendations", apiGenAIRateLimiter, productController.recommendProducts);

// Private routes (protected)
router.post("/", authenticateToken, productController.add);
router.put("/:id", authenticateToken, productController.update);
router.patch("/:id/flags", authenticateToken, productController.updateProductFlags);
router.patch("/:id/discount", authenticateToken, productController.updateProductDiscount);
router.delete("/:id", authenticateToken, productController.remove);

export default router;
