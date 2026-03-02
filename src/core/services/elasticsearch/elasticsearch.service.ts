/**
 * Elasticsearch service for product search and indexing.
 *
 * Responsibilities:
 * - Index lifecycle (create / recreate / ensure)
 * - Document CRUD (index / update / delete / bulk)
 * - Full-text search with filters, sorting, pagination
 *
 * This service is consumed by product.service.ts.
 * MongoDB remains the source of truth — ES is a read-optimised search index.
 */
import { getElasticsearchClient } from "@/core/config/elasticsearch"
import { PRODUCTS_INDEX, PRODUCTS_INDEX_SETTINGS, SEARCH_FIELD_BOOSTS } from "@/core/constants/elasticsearch"
import { logger } from "@/core/config/logger"
import type { Product } from "@/modules/product/product.types"
import type { SortCombinations } from "@elastic/elasticsearch/lib/api/types"
import type { ProductESDocument, ESSearchParams, ESSearchResult } from "./elasticsearch.types"

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a MongoDB Product document into the flat shape stored in ES.
 */
const toESDocument = (product: Product): ProductESDocument => ({
  mongoId: product._id!.toString(),
  name: product.name,
  description: product.description,
  brand: product.brand,
  price: product.price,
  discount: product.discount,
  finalPrice: product.discount
    ? product.price - (product.price * product.discount / 100)
    : product.price,
  tilesPerBox: product.tilesPerBox,
  isBestSeller: product.isBestSeller ?? false,
  isNewArrivals: product.isNewArrivals ?? false,
  recommended: product.recommended ?? [],
  createdAt: product.createdAt instanceof Date ? product.createdAt.toISOString() : String(product.createdAt),
  updatedAt: product.updatedAt instanceof Date ? product.updatedAt.toISOString() : String(product.updatedAt),
  specification: {
    design: product.specification.design,
    texture: product.specification.texture,
    finishing: product.specification.finishing,
    color: product.specification.color,
    application: product.specification.application,
    isWaterResistant: product.specification.isWaterResistant,
    isSlipResistant: product.specification.isSlipResistant,
    size: {
      width: product.specification.size.width,
      height: product.specification.size.height
    }
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
//  INDEX LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Idempotent — creates the index only if it does not already exist.
 * Safe to call on every application startup.
 */
const ensureIndex = async (): Promise<void> => {
  const client = getElasticsearchClient()
  const exists = await client.indices.exists({ index: PRODUCTS_INDEX })

  if (!exists) {
    await client.indices.create({
      index: PRODUCTS_INDEX,
      ...PRODUCTS_INDEX_SETTINGS
    })
    logger.info(`[ES] Index "${PRODUCTS_INDEX}" created with custom mapping`)
  } else {
    logger.info(`[ES] Index "${PRODUCTS_INDEX}" already exists — skipping creation`)
  }
}

/**
 * Drop and recreate the index. **Destructive** — only use for reindex operations.
 */
const recreateIndex = async (): Promise<void> => {
  const client = getElasticsearchClient()
  const exists = await client.indices.exists({ index: PRODUCTS_INDEX })

  if (exists) {
    await client.indices.delete({ index: PRODUCTS_INDEX })
    logger.info(`[ES] Index "${PRODUCTS_INDEX}" deleted`)
  }

  await client.indices.create({
    index: PRODUCTS_INDEX,
    ...PRODUCTS_INDEX_SETTINGS
  })
  logger.info(`[ES] Index "${PRODUCTS_INDEX}" recreated with fresh mapping`)
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DOCUMENT CRUD
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Index (insert/replace) a single product document.
 * Uses mongoId as the ES document `_id` so upserts are automatic.
 */
const indexProduct = async (product: Product): Promise<void> => {
  const client = getElasticsearchClient()
  const doc = toESDocument(product)

  await client.index({
    index: PRODUCTS_INDEX,
    id: doc.mongoId,          // use Mongo _id as ES _id — makes update/delete easy
    document: doc,
    refresh: "wait_for"       // make it immediately searchable (dev-friendly)
  })

  logger.info(`[ES] Indexed product: ${doc.mongoId} (${product.name})`)
}

/**
 * Partial update of a product in the index.
 * Re-indexes the full document for simplicity and to keep finalPrice in sync.
 */
const updateProduct = async (product: Product): Promise<void> => {
  // Simplest reliable approach: re-index the full document.
  // ES `index` with the same _id is an upsert.
  await indexProduct(product)
}

/**
 * Delete a single product from the index.
 */
const deleteProduct = async (mongoId: string): Promise<void> => {
  const client = getElasticsearchClient()

  try {
    await client.delete({
      index: PRODUCTS_INDEX,
      id: mongoId,
      refresh: "wait_for"
    })
    logger.info(`[ES] Deleted product: ${mongoId}`)
  } catch (err: unknown) {
    // 404 is fine — document may not exist in ES yet
    if (err && typeof err === "object" && "statusCode" in err && (err as { statusCode: number }).statusCode === 404) {
      logger.warn(`[ES] Delete skipped — product not found in index: ${mongoId}`)
      return
    }
    throw err
  }
}

/**
 * Bulk-index an array of products. Used by the reindex script.
 * Returns counts of successfully indexed and errored documents.
 */
const bulkIndexProducts = async (
  products: Product[]
): Promise<{ indexed: number; errors: number }> => {
  if (products.length === 0) return { indexed: 0, errors: 0 }

  const client = getElasticsearchClient()

  // Build the NDJSON body expected by the bulk API:
  // { index: { _index, _id } }
  // { ...document }
  const operations = products.flatMap(product => {
    const doc = toESDocument(product)
    return [
      { index: { _index: PRODUCTS_INDEX, _id: doc.mongoId } },
      doc
    ]
  })

  const result = await client.bulk({
    refresh: "wait_for",
    operations
  })

  let errorCount = 0
  if (result.errors) {
    for (const item of result.items) {
      if (item.index?.error) {
        errorCount++
        logger.error(`[ES] Bulk index error for ${item.index._id}: ${JSON.stringify(item.index.error)}`)
      }
    }
  }

  const indexedCount = products.length - errorCount
  logger.info(`[ES] Bulk indexed ${indexedCount} products (${errorCount} errors)`)
  return { indexed: indexedCount, errors: errorCount }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SEARCH
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build the Elasticsearch bool query from search text + faceted filters.
 */
const buildQuery = (params: ESSearchParams) => {
  const { searchQuery, filters } = params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const must: any[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filterClauses: any[] = []

  // ── Full-text search (affects relevance score) ──
  if (searchQuery) {
    must.push({
      multi_match: {
        query: searchQuery,
        fields: SEARCH_FIELD_BOOSTS,
        type: "best_fields",
        fuzziness: "AUTO",
        operator: "or"
      }
    })
  }

  // ── Faceted filters (exact match, cached, no score impact) ──
  if (filters) {
    if (filters.design && filters.design.length > 0) {
      filterClauses.push({ terms: { "specification.design.keyword": filters.design } })
    }
    if (filters.texture && filters.texture.length > 0) {
      filterClauses.push({ terms: { "specification.texture": filters.texture } })
    }
    if (filters.finishing && filters.finishing.length > 0) {
      filterClauses.push({ terms: { "specification.finishing": filters.finishing } })
    }
    if (filters.color && filters.color.length > 0) {
      filterClauses.push({ terms: { "specification.color": filters.color } })
    }
    if (filters.application && filters.application.length > 0) {
      filterClauses.push({ terms: { "specification.application": filters.application } })
    }
    if (filters.recommended && filters.recommended.length > 0) {
      filterClauses.push({ terms: { recommended: filters.recommended } })
    }

    // Size filter — each size pair is an OR condition (should match at least one)
    if (filters.size && filters.size.length > 0) {
      const sizeShould = filters.size.map(s => ({
        bool: {
          must: [
            { term: { "specification.size.width": s.width } },
            { term: { "specification.size.height": s.height } }
          ]
        }
      }))
      filterClauses.push({ bool: { should: sizeShould, minimum_should_match: 1 } })
    }

    // Price range
    if (filters.price) {
      filterClauses.push({
        range: {
          finalPrice: {
            ...(filters.price.min !== undefined && { gte: filters.price.min }),
            ...(filters.price.max !== undefined && { lte: filters.price.max })
          }
        }
      })
    }

    // Boolean flags
    if (filters.discounted) filterClauses.push({ range: { discount: { gt: 0 } } })
    if (filters.bestSeller) filterClauses.push({ term: { isBestSeller: true } })
    if (filters.newArrivals) filterClauses.push({ term: { isNewArrivals: true } })
  }

  return {
    bool: {
      ...(must.length > 0 && { must }),
      ...(filterClauses.length > 0 && { filter: filterClauses })
    }
  }
}

/**
 * Build the ES sort array from orderBy param.
 */
const buildSort = (orderBy?: string, hasSearchQuery?: boolean): SortCombinations[] => {
  switch (orderBy) {
    case "price_asc":
      return [{ finalPrice: { order: "asc" } }]
    case "price_desc":
      return [{ finalPrice: { order: "desc" } }]
    case "name_asc":
      return [{ "name.keyword": { order: "asc" } }]
    case "name_desc":
      return [{ "name.keyword": { order: "desc" } }]
    default:
      // When there's a search query, sort by relevance first, then newest
      if (hasSearchQuery) {
        return [
          { _score: { order: "desc" } },
          { createdAt: { order: "desc" } }
        ]
      }
      // No search → newest first
      return [{ createdAt: { order: "desc" } }]
  }
}

/**
 * Execute a full product search.
 *
 * Returns an array of MongoDB `_id` strings in relevance/sort order,
 * plus the total hit count for pagination.
 */
const searchProducts = async (params: ESSearchParams): Promise<ESSearchResult> => {
  const client = getElasticsearchClient()

  const page = params.page ?? 1
  const size = params.size ?? 10
  const from = (page - 1) * size

  const query = buildQuery(params)
  const sort = buildSort(params.orderBy, !!params.searchQuery)

  const result = await client.search({
    index: PRODUCTS_INDEX,
    query,
    sort,
    from,
    size,
    _source: ["mongoId"]  // we only need IDs — full data comes from MongoDB
  })

  const total = typeof result.hits.total === "number"
    ? result.hits.total
    : result.hits.total?.value ?? 0

  const ids = result.hits.hits
    .map(hit => (hit._source as { mongoId: string } | undefined)?.mongoId)
    .filter((id): id is string => !!id)

  logger.info(`[ES] Search returned ${ids.length} / ${total} results (page ${page}, size ${size})`)

  return { ids, total }
}

// ─── Export ───────────────────────────────────────────────────────────────────

const elasticsearchService = {
  ensureIndex,
  recreateIndex,
  indexProduct,
  updateProduct,
  deleteProduct,
  bulkIndexProducts,
  searchProducts
}

export default elasticsearchService