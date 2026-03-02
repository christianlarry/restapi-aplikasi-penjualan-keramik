import { Client } from "@elastic/elasticsearch"
import { env } from "./env"
import { logger } from "./logger"

let client: Client | null = null

/**
 * Lazily-initialised Elasticsearch client singleton.
 * Safe to call multiple times — the same Client instance is returned.
 */
export const getElasticsearchClient = (): Client => {
  if (!client) {
    client = new Client({ node: env.ELASTICSEARCH_URL })
    logger.info(`[Elasticsearch] Client initialized → ${env.ELASTICSEARCH_URL}`)
  }
  return client
}

/**
 * Ping Elasticsearch to verify the cluster is reachable.
 * Called once at bootstrap so startup fails fast if ES is down.
 */
export const pingElasticsearch = async (): Promise<void> => {
  const es = getElasticsearchClient()
  const ok = await es.ping()
  if (!ok) throw new Error("Elasticsearch cluster did not respond to ping")
  logger.info("🔍 Elasticsearch cluster is reachable")
}

/**
 * Close the Elasticsearch connection (for graceful shutdown).
 */
export const closeElasticsearch = async (): Promise<void> => {
  if (client) {
    await client.close()
    client = null
    logger.info("[Elasticsearch] Connection closed")
  }
}
