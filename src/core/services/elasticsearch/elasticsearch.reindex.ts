/**
 * Reindex Script — Elasticsearch
 *
 * Drops the existing products index, recreates it with the latest mapping,
 * then bulk-indexes every product from MongoDB.
 *
 * Usage:
 *   npx tsx src/core/services/elasticsearch/elasticsearch.reindex.ts
 */

import { connectToMongoDB, disconnectFromMongoDB } from "@/core/config/mongodb"
import { closeElasticsearch } from "@/core/config/elasticsearch"
import { logger } from "@/core/config/logger"
import elasticsearchService from "./elasticsearch.service"
import { productRepository } from "@/modules/product/product.repository"

const reindex = async () => {
  logger.info("🔄 Starting Elasticsearch reindex...")

  // 1. Connect to MongoDB (required by productRepository)
  await connectToMongoDB()

  // 2. Recreate the index (drop + create with fresh mapping)
  await elasticsearchService.recreateIndex()
  logger.info("✅ Index recreated")

  // 3. Fetch all products from MongoDB
  const products = await productRepository.findAll()
  logger.info(`📦 Found ${products.length} products in MongoDB`)

  if (products.length === 0) {
    logger.info("⚠️  No products to index. Done.")
    return
  }

  // 4. Bulk index into Elasticsearch
  await elasticsearchService.bulkIndexProducts(products)
  logger.info(`✅ Successfully indexed ${products.length} products into Elasticsearch`)
}

reindex()
  .catch((err) => {
    logger.error("❌ Reindex failed:", err)
    process.exitCode = 1
  })
  .finally(async () => {
    await Promise.allSettled([disconnectFromMongoDB(), closeElasticsearch()])
    process.exit()
  })
