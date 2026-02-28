import { Router } from "express";
import productRoutes from "@/modules/product/product.routes";
import userRoutes from "@/modules/user/user.routes";
import uploadRoutes from "@/modules/upload/upload.routes";
import chatRoutes from "@/modules/recommendation/chat/chat.routes";

const router = Router();

router.use("/product", productRoutes);
router.use("/user", userRoutes);
router.use("/upload", uploadRoutes);
router.use("/recommendations", chatRoutes);

export default router;
