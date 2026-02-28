import { Router } from "express";
import { authenticateToken } from "@/core/middlewares/auth.middleware";
import userController from "./user.controller";

const router = Router();

// Public routes
router.post("/login", userController.login);

// Private routes (protected)
router.post("/register", authenticateToken, userController.register);

export default router;
