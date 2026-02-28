import express, { Application } from "express"
import cors from "cors"
import morgan from "morgan"
import compression from "compression"

import apiRoutes from "@/routes/index"
import { errorMiddleware } from "@/core/middlewares/error.middleware"
import { env } from "@/core/config/env"

export const app: Application = express()

// Top Middleware
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static("public"))
app.use(cors())
app.use(compression())

// Logging Middleware
if (env.NODE_ENV === "development") {
  app.use(morgan("dev"))
} else if (env.NODE_ENV === "production") {
  app.use(morgan("combined"))
}

// Routes — auth is applied per-route inside each module
app.use("/api", apiRoutes)

// Health Check
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" })
})

// Bottom Middleware
app.use(errorMiddleware)