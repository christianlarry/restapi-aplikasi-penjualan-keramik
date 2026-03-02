/**
 * Elasticsearch index constants — mapping, settings, field boosts.
 *
 * The mapping is designed for a ceramic-tile product catalog with mixed
 * Indonesian and English content, fuzzy search, and faceted filtering.
 */
import { env } from "@/core/config/env"

// ─── Index Name ───────────────────────────────────────────────────────────────

export const PRODUCTS_INDEX = `${env.ELASTICSEARCH_INDEX_PREFIX}_products`

// ─── Field Boost Weights (for multi_match queries) ────────────────────────────

export const SEARCH_FIELD_BOOSTS = [
  "name^3",
  "brand^2",
  "specification.design^2",
  "recommended^1.5",
  "description^1"
]

// ─── Index Settings + Mapping ─────────────────────────────────────────────────

export const PRODUCTS_INDEX_SETTINGS = {
  settings: {
    analysis: {
      analyzer: {
        /**
         * Custom analyzer for Indonesian + English product text.
         * - standard tokenizer: word-level splitting, handles punctuation
         * - lowercase: case-insensitive search
         * - asciifolding: normalise accented characters (é→e, ü→u)
         */
        product_text_analyzer: {
          type: "custom" as const,
          tokenizer: "standard",
          filter: ["lowercase", "asciifolding"]
        }
      }
    },
    number_of_shards: 1,   // single-node dev — 1 shard is optimal
    number_of_replicas: 0  // no replicas in dev (would stay yellow otherwise)
  },

  mappings: {
    properties: {
      // ── Identity ──
      mongoId: { type: "keyword" as const },

      // ── Searchable text fields (text + keyword sub-field for sorting) ──
      name: {
        type: "text" as const,
        analyzer: "product_text_analyzer",
        fields: { keyword: { type: "keyword" as const } }
      },
      description: {
        type: "text" as const,
        analyzer: "product_text_analyzer"
      },
      brand: {
        type: "text" as const,
        analyzer: "product_text_analyzer",
        fields: { keyword: { type: "keyword" as const } }
      },

      // ── Numeric ──
      price: { type: "double" as const },
      discount: { type: "double" as const },
      finalPrice: { type: "double" as const },
      tilesPerBox: { type: "integer" as const },

      // ── Flags ──
      isBestSeller: { type: "boolean" as const },
      isNewArrivals: { type: "boolean" as const },

      // ── Tags (keyword arrays for filter/aggregation) ──
      recommended: { type: "keyword" as const },

      // ── Dates ──
      createdAt: { type: "date" as const },
      updatedAt: { type: "date" as const },

      // ── Specification (nested object mapped explicitly) ──
      specification: {
        properties: {
          design: {
            type: "text" as const,
            analyzer: "product_text_analyzer",
            fields: { keyword: { type: "keyword" as const } }
          },
          texture: { type: "keyword" as const },
          finishing: { type: "keyword" as const },
          color: { type: "keyword" as const },
          application: { type: "keyword" as const },
          isWaterResistant: { type: "boolean" as const },
          isSlipResistant: { type: "boolean" as const },
          size: {
            properties: {
              width: { type: "integer" as const },
              height: { type: "integer" as const }
            }
          }
        }
      }
    }
  }
}
