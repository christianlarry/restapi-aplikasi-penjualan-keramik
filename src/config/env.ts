import { z } from "zod"
import dotenv from "dotenv"

// Load .env file into process.env (if present)
dotenv.config()

/*
  Validation schema for required environment variables.
  - We validate strings from `process.env` and transform numeric values to numbers.
  - Keep messages concise so failures are easy to diagnose at startup.
*/
const envValidationSchema = z.object({
  // Application environment mode (affects logging, behavior)
  NODE_ENV: z.enum(["development", "production", "test"]),

  // Port the HTTP server will listen on (parsed to number)
  PORT: z.string().transform((val) => parseInt(val, 10)),

  CORS_ORIGIN: z.string().min(1, "CORS origin is required"),

  // MongoDB connection information
  // - MONGODB_URI: base connection string (e.g. mongodb://user:pass@host:port)
  // - MONGODB_NAME: name of the database (can be appended to URI if not included)
  MONGODB_URI: z.string().min(1, "MongoDB URI is required"),
  MONGODB_NAME: z.string().min(1, "MongoDB database name is required"),

  // JWT configuration
  JWT_SECRET: z.string().min(1, "JWT secret is required"),
  // Access token expiration (in minutes) — parsed to number
  JWT_ACCESS_EXPIRATION_MINUTE: z.string().transform((val) => parseInt(val, 10)),
  JWT_REFRESH_SECRET: z.string().min(1, "JWT refresh secret is required"),
  JWT_REFRESH_EXPIRATION_DAYS: z.string().transform((val) => parseInt(val, 10)),

  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.string().default("6379").transform((val) => parseInt(val, 10)),
  REDIS_PASSWORD: z.string().optional(),
})

// Parse & validate process.env against the schema
const envValidation = envValidationSchema.safeParse(process.env)

if (!envValidation.success) {
  // `safeParse` returns detailed `issues` on failure — log and stop startup
  console.error("❌ Invalid environment variables:", envValidation.error.flatten())
  throw new Error("Invalid environment variables")
} else {
  console.log("✅ Environment variables loaded and validated successfully.")
}

// Export the parsed/validated env object for use across the app
export const env = envValidation.data