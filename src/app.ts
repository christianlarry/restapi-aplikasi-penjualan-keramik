import express, { Express } from "express"
import cors from "cors"
import morgan from "morgan"

// IMPORT ROUTES
import publicRoutes from "@routes/public.routes"
import privateRoutes from "@routes/private.routes"
import { errorMiddleware } from "@/middlewares/error.middleware"
import { authenticateToken } from "@/middlewares/auth.middleware"

export const web: Express = express() // Create an Express application

// Top Middleware
web.use(express.json()) // Parse JSON bodies
web.use(express.urlencoded({ extended: true })) // Parse URL-encoded bodies
web.use(express.static("public")) // Serve static files from the "public" directory
web.use(cors()) // Enable CORS for all origins
web.use(morgan("common")) // Logging Middleware
// web.use(apiRateLimiter) // Rate Limiter Middleware

// Routes
// ------ Some routes here -------
web.use("/api", publicRoutes) // Public Routes
web.use("/api", authenticateToken, privateRoutes) // Private Routes (requires authentication) 

// Bottom Middleware
web.use(errorMiddleware) // Error Handling Middleware