import { env } from "@/core/config/env"
import { app } from "@/app"
import { connectToMongoDB, disconnectFromMongoDB } from "@/core/config/mongodb"
import { logger } from "@/core/config/logger"
import { disconnectRedis } from "@/core/config/redis"

const PORT = env.PORT || 3000

let server: ReturnType<typeof app.listen>

const start = async () => {
  // Connect to MongoDB (fail-fast if connection is invalid)
  await connectToMongoDB()

  server = app.listen(PORT, () => {
    logger.info(`Server up and running at http://localhost:${PORT}`)
    logger.info(`Environment: ${env.NODE_ENV}`)
  })
}

start().catch((error) => {
  logger.error("Failed to start server:", error)
  process.exit(1)
})

// Graceful Shutdown Logic
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  // 1. Stop accepting new requests
  server.close(async (err) => {
    if (err) {
      logger.error("Error closing HTTP server:", err);
      process.exit(1);
    }
    logger.info("HTTP server closed.");

    try {
      // 2. Close Database Connections
      // We do this in parallel to speed up shutdown
      await Promise.all([
        disconnectFromMongoDB(),
        disconnectRedis()
      ]);

      logger.info("All connections closed. Exiting process.");
      process.exit(0);
    } catch (error) {
      logger.error("Error during resource cleanup:", error);
      process.exit(1);
    }
  });

  // Force exit if shutdown takes too long (e.g., 10 seconds)
  setTimeout(() => {
    logger.error("Could not close connections in time, forcefully shutting down");
    process.exit(1);
  }, 10000);
};

// Listen for termination signals
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));