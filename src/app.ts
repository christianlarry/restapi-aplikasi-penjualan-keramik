import express, { Application } from "express"
import cors from "cors"
import morgan from "morgan"
import compression from "compression"

// IMPORT ROUTES
import publicRoutes from "@/routes/public.routes"
import privateRoutes from "@/routes/private.routes"
import { errorMiddleware } from "@/middlewares/error.middleware"
import { authenticateToken } from "@/middlewares/auth.middleware"
import { env } from "./config/env"

export const app: Application = express() // Create an Express application

// Top Middleware
app.use(express.json()) // Parse JSON bodies
app.use(express.urlencoded({ extended: true })) // Parse URL-encoded bodies
app.use(express.static("public")) // Serve static files from the "public" directory
app.use(cors()) // Enable CORS for all origins
app.use(compression()) // Enable response compression

// Logging Middleware
if (env.NODE_ENV === "development") {
  app.use(morgan("dev")) // Detailed logging in development
} else if (env.NODE_ENV === "production") {
  app.use(morgan("combined")) // Standard Apache combined logging in production
}
// app.use(apiRateLimiter) // Rate Limiter Middleware

// Routes
// ------ Some routes here -------
app.use("/api", publicRoutes) // Public Routes
app.use("/api", authenticateToken, privateRoutes) // Private Routes (requires authentication) 

// Health Check
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" })
})

// Bottom Middleware
app.use(errorMiddleware) // Error Handling Middleware