# Elasticsearch Implementation Plan — Product Search

## 0. Kenapa Elasticsearch?

MongoDB regex search saat ini mempunyai beberapa kelemahan:

| Masalah | MongoDB Regex | Elasticsearch |
|---|---|---|
| Typo tolerance | ❌ Gagal jika salah ketik | ✅ Fuzzy matching |
| Relevance scoring | ❌ Semua hasil sama | ✅ Urutan by relevansi |
| Full-text search | ❌ Substring only | ✅ Tokenized, stemmed |
| Performa di scale | ❌ Full collection scan | ✅ Inverted index, O(1) lookup |
| Multilingual | ❌ Tidak ada | ✅ Built-in language analyzer |
| Highlighting | ❌ Tidak ada | ✅ Snippet matched terms |

---

## 1. Arsitektur Keseluruhan

```
Client Request
     │
     ▼
ProductController (tidak berubah)
     │
     ▼
ProductService.getMany() / getPaginated()
     │
     ├─── searchQuery ada? ──── YES ──► ElasticSearchService.searchProducts()
     │                                         │
     │    ◄── ids[] ─────────────────────────────
     │         │
     │    productRepository.findByIds(ids)  ← MongoDB (source of truth)
     │
     └─── searchQuery tidak ada? ──► productRepository (MongoDB biasa, tidak berubah)

SYNC (write path):
ProductService.create/update/remove
     │
     └─► ElasticSearchService.indexProduct / updateProduct / deleteProduct
```

**Pola: ES sebagai search index, MongoDB tetap source of truth.**
- ES hanya menyimpan data yang dibutuhkan untuk search + filter.
- Data lengkap (image, timestamps, dll) tetap diambil dari MongoDB by ID.
- Jika ES down, fallback otomatis ke MongoDB regex.

---

## 2. File yang Akan Dibuat / Diubah

### File Baru
```
src/core/config/elasticsearch.ts          ← ES client singleton
src/core/services/elasticsearch/
  elasticsearch.service.ts               ← CRUD + search logic (sudah ada, akan diisi)
  elasticsearch.types.ts                 ← ProductDocument type untuk ES
  elasticsearch.reindex.ts               ← One-time full sync script
src/core/constants/elasticsearch.ts      ← Index name, field boosts, dll
```

### File yang Diubah
```
src/core/config/env.ts                   ← Tambah ELASTICSEARCH_URL
docker-compose.yml                       ← Tambah service Elasticsearch
src/modules/product/product.service.ts   ← Hook indexing di create/update/delete, ganti search
src/main.ts                              ← Bootstrap ES connection + ensure index
.env                                     ← Tambah ELASTICSEARCH_URL
```

---

## 3. Docker Setup

Tambahkan ke `docker-compose.yml`:

```yaml
elasticsearch:
  image: docker.elastic.co/elasticsearch/elasticsearch:8.13.0
  container_name: penjualan-keramik-elasticsearch
  restart: unless-stopped
  environment:
    - discovery.type=single-node        # Untuk development (single node, tidak butuh cluster)
    - xpack.security.enabled=false      # Nonaktifkan auth untuk dev (aktifkan di prod)
    - ES_JAVA_OPTS=-Xms512m -Xmx512m   # Limit RAM (sesuaikan dengan mesin dev)
  ports:
    - "9200:9200"
  volumes:
    - penjualan_keramik_es_data:/usr/share/elasticsearch/data
  healthcheck:
    test: ["CMD-SHELL", "curl -s http://localhost:9200/_cat/health | grep -q green\\|yellow"]
    interval: 10s
    timeout: 5s
    retries: 30

volumes:
  penjualan_keramik_redis_data:
  penjualan_keramik_es_data:      ← tambahkan ini
```

> **Catatan:** ES 8.x secara default mengaktifkan TLS + auth. `xpack.security.enabled=false`
> mematikan keduanya untuk kemudahan dev. **Jangan pakai ini di production.**

---

## 4. Environment Variables

### `src/core/config/env.ts` — tambahkan ke schema Zod:
```typescript
ELASTICSEARCH_URL: z.string().default("http://localhost:9200"),
ELASTICSEARCH_INDEX_PREFIX: z.string().default("penjualan_keramik"),
```

### `.env`:
```
ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_INDEX_PREFIX=penjualan_keramik
```

---

## 5. ES Client Singleton

**`src/core/config/elasticsearch.ts`**

```typescript
import { Client } from "@elastic/elasticsearch"
import { env } from "./env"
import { logger } from "./logger"

let client: Client | null = null

export const getElasticsearchClient = (): Client => {
  if (!client) {
    client = new Client({ node: env.ELASTICSEARCH_URL })
    logger.info(`[Elasticsearch] Client initialized → ${env.ELASTICSEARCH_URL}`)
  }
  return client
}
```

Pola singleton sama seperti `getDb()` di `mongodb.ts`.

---

## 6. Index Mapping & Analyzer

Ini bagian paling kritis. Mapping menentukan bagaimana ES menyimpan dan mengindex data.

### Konsep penting:
- **`text`**: Di-tokenize dan di-analyze → cocok untuk full-text search (nama produk, deskripsi)
- **`keyword`**: Disimpan exact → cocok untuk filter, sorting, aggregation (design, color, dll)
- **`double field mapping`**: Satu field punya dua tipe (`text` untuk search + `keyword` untuk filter)

### Mapping yang akan dipakai:

```typescript
// src/core/constants/elasticsearch.ts

export const INDEX_NAME = `${env.ELASTICSEARCH_INDEX_PREFIX}_products`

export const PRODUCT_INDEX_MAPPING = {
  settings: {
    analysis: {
      analyzer: {
        // Analyzer untuk teks Indonesia + Inggris
        // Lowercase + stopword removal standar
        product_text_analyzer: {
          type: "custom",
          tokenizer: "standard",
          filter: ["lowercase", "asciifolding"]  // asciifolding: handle é→e, dll
        }
      }
    },
    number_of_shards: 1,    // Dev: 1 shard cukup
    number_of_replicas: 0   // Dev: 0 replica (butuh node tambahan untuk replica)
  },
  mappings: {
    properties: {
      mongoId:     { type: "keyword" },          // MongoDB _id (string)
      name:        {                              // Field utama search
        type: "text",
        analyzer: "product_text_analyzer",
        fields: { keyword: { type: "keyword" } } // .keyword untuk sorting
      },
      description: {
        type: "text",
        analyzer: "product_text_analyzer"
      },
      brand: {
        type: "text",
        analyzer: "product_text_analyzer",
        fields: { keyword: { type: "keyword" } }
      },
      price:    { type: "double" },
      discount: { type: "double" },
      finalPrice: { type: "double" },   // Pre-computed, disimpan di ES
      tilesPerBox: { type: "integer" },
      isBestSeller: { type: "boolean" },
      isNewArrivals: { type: "boolean" },
      recommended: { type: "keyword" },  // Array of strings — keyword untuk filter
      createdAt: { type: "date" },
      updatedAt: { type: "date" },

      // Specification (semua filter: keyword, beberapa juga text untuk fuzzy)
      "specification.design": {
        type: "text",
        analyzer: "product_text_analyzer",
        fields: { keyword: { type: "keyword" } }
      },
      "specification.texture":    { type: "keyword" },
      "specification.finishing":  { type: "keyword" },
      "specification.color":      { type: "keyword" },   // Array
      "specification.application": { type: "keyword" },  // Array
      "specification.isWaterResistant": { type: "boolean" },
      "specification.isSlipResistant":  { type: "boolean" },
      "specification.size": {
        properties: {
          width:  { type: "integer" },
          height: { type: "integer" }
        }
      }
    }
  }
}
```

---

## 7. Product Document Type

**`src/core/services/elasticsearch/elasticsearch.types.ts`**

```typescript
// Shape of a document stored in Elasticsearch (flat structure)
export interface ProductESDocument {
  mongoId: string                  // MongoDB _id.toString()
  name: string
  description?: string
  brand: string
  price: number
  discount?: number
  finalPrice: number               // Pre-computed: price - (price * discount / 100)
  tilesPerBox: number
  isBestSeller: boolean
  isNewArrivals: boolean
  recommended: string[]
  createdAt: string                // ISO string
  updatedAt: string

  // Specification (flattened for ES)
  "specification.design": string
  "specification.texture": string
  "specification.finishing": string
  "specification.color": string[]
  "specification.application": string[]
  "specification.isWaterResistant": boolean
  "specification.isSlipResistant": boolean
  "specification.size": {
    width: number
    height: number
  }
}
```

---

## 8. ElasticsearchService — Method Overview

**`src/core/services/elasticsearch/elasticsearch.service.ts`**

Kelas ini punya 3 kelompok method:

### 8.1 Setup Methods
```typescript
// Cek apakah index sudah ada, kalau belum buat dengan mapping di atas
ensureIndex(): Promise<void>

// Hapus dan buat ulang index (hanya untuk development/reindex)
recreateIndex(): Promise<void>
```

### 8.2 Document CRUD (Sync dengan MongoDB)
```typescript
// Index satu dokumen (dipanggil setelah create product di MongoDB)
indexProduct(product: Product): Promise<void>

// Update dokumen (dipanggil setelah update product di MongoDB)
// Pakai ES _update API — hanya field yang berubah, tidak replace seluruh doc
updateProduct(mongoId: string, product: Partial<Product>): Promise<void>

// Hapus dokumen
deleteProduct(mongoId: string): Promise<void>

// Bulk index (untuk reindex script)
bulkIndexProducts(products: Product[]): Promise<{ indexed: number, errors: number }>
```

### 8.3 Search Method
```typescript
// Full search + filter + sort + pagination
// Returns: array of MongoDB ObjectId strings (urut by relevance)
searchProducts(params: ESSearchParams): Promise<{ ids: string[], total: number }>

interface ESSearchParams {
  searchQuery?: string
  filters?: ProductFilters
  orderBy?: ProductOrderBy
  page?: number
  size?: number
}
```

---

## 9. Query DSL — Detail Search Query

Ini bagian yang sering membingungkan pemula. Penjelasan lengkap:

### Struktur bool query:

```
bool
├── must      → WAJIB match, mempengaruhi score
├── filter    → WAJIB match, TIDAK mempengaruhi score (lebih cepat, di-cache)
├── should    → opsional match, meningkatkan score jika match
└── must_not  → WAJIB tidak match
```

**Strategi yang dipakai:**
- `searchQuery` → masuk ke `must` dengan `multi_match` (mempengaruhi relevance score)
- Semua filter (design, color, dll) → masuk ke `filter` (lebih cepat karena di-cache ES)

### Query yang akan dibangun:

```json
{
  "query": {
    "bool": {
      "must": [
        {
          "multi_match": {
            "query": "keramik kayu ruang tamu",
            "fields": [
              "name^3",           // Boost 3x — nama paling relevan
              "brand^2",          // Boost 2x
              "specification.design^2",
              "description^1",    // Boost 1x
              "recommended^1.5"
            ],
            "type": "best_fields",
            "fuzziness": "AUTO",  // Toleransi typo: AUTO = 1 edit untuk 3-5 char, 2 edit untuk 6+ char
            "operator": "or"      // Cukup salah satu kata match
          }
        }
      ],
      "filter": [
        { "terms": { "specification.design.keyword": ["Kayu", "Wood"] } },
        { "terms": { "specification.color": ["Putih", "Cream"] } },
        { "terms": { "specification.finishing": ["Glossy"] } },
        { "range": { "finalPrice": { "gte": 50000, "lte": 200000 } } },
        { "term": { "isBestSeller": true } }
      ]
    }
  },
  "sort": [
    { "_score": { "order": "desc" } },   // Relevance utama
    { "createdAt": { "order": "desc" } } // Tiebreaker
  ],
  "from": 0,    // offset = (page - 1) * size
  "size": 10
}
```

### Sorting:
```typescript
// price_asc/desc → sort by finalPrice
// name_asc/desc  → sort by name.keyword (keyword field untuk sort, bukan text)
// default        → sort by _score desc, createdAt desc
```

---

## 10. Integrasi dengan ProductService

### 10.1 Write path (sync to ES)

Di `product.service.ts`, tambahkan hook di setiap mutasi:

```typescript
// Setelah create:
const created = await productRepository.insertOne(...)
await elasticSearchService.indexProduct(created)  // ← fire-and-forget dengan catch

// Setelah update:
const updated = await productRepository.findOneAndUpdate(...)
await elasticSearchService.updateProduct(id, updated)

// Setelah delete:
await productRepository.findOneAndDelete(...)
await elasticSearchService.deleteProduct(id)
```

**Pattern fire-and-forget dengan log:**
```typescript
elasticSearchService.indexProduct(product).catch(err =>
  logger.error("[ES] Failed to index product:", err)
)
```
Kenapa fire-and-forget? Karena MongoDB sudah berhasil. Kegagalan ES tidak boleh membuat API return error ke client. ES akan di-sync ulang saat reindex.

### 10.2 Read path (search via ES)

```typescript
const getMany = async (searchQuery, filters, orderBy?, limit?) => {
  // Jika ada searchQuery → gunakan ES
  if (searchQuery) {
    const { ids, total } = await elasticSearchService.searchProducts({
      searchQuery, filters, orderBy, size: limit ?? 100
    })

    if (ids.length === 0) return []

    // Ambil data lengkap dari MongoDB by IDs (tetap fresh, source of truth)
    const products = await productRepository.findByIds(ids.map(id => new ObjectId(id)))

    // Sort sesuai urutan dari ES (karena MongoDB findByIds tidak preserve order)
    const productMap = new Map(products.map(p => [p._id!.toString(), p]))
    return ids.map(id => productMap.get(id)).filter(Boolean).map(toResponse)
  }

  // Jika tidak ada searchQuery → MongoDB biasa (tidak berubah)
  // ...existing code...
}
```

### 10.3 Graceful degradation

```typescript
if (searchQuery) {
  try {
    const { ids } = await elasticSearchService.searchProducts(...)
    // ...
  } catch (err) {
    logger.error("[ES] Search failed, falling back to MongoDB:", err)
    // Fall back ke MongoDB regex search
    const products = await productRepository.aggregate(pipelineWithRegex)
    return products.map(toResponse)
  }
}
```

---

## 11. Repository: `findByIds`

Perlu tambahkan satu method baru ke `product.repository.ts`:

```typescript
const findByIds = async (ids: ObjectId[]): Promise<Product[]> => {
  return collection().find({ _id: { $in: ids } }).toArray() as Promise<Product[]>
}
```

---

## 12. Reindex Script

**`src/core/services/elasticsearch/elasticsearch.reindex.ts`**

Script CLI untuk initial sync dan recovery. Dijalankan sekali:

```typescript
// npx ts-node -r tsconfig-paths/register src/core/services/elasticsearch/elasticsearch.reindex.ts

async function reindex() {
  await connectMongoDB()
  await elasticsearchService.recreateIndex()

  const all = await productRepository.findAll()
  const { indexed, errors } = await elasticsearchService.bulkIndexProducts(all)

  console.log(`Reindex complete: ${indexed} indexed, ${errors} errors`)
  process.exit(0)
}
```

Bulk API ES jauh lebih efisien dari indexing satu-satu. Untuk 10.000 dokumen, bulk satu batch vs 10.000 HTTP request.

---

## 13. Bootstrap di `main.ts`

```typescript
// Di main.ts, setelah MongoDB connect:
await elasticsearchService.ensureIndex()
logger.info("✅ Elasticsearch index ensured")
```

`ensureIndex()` bersifat idempotent — aman dipanggil setiap startup, hanya membuat index jika belum ada.

---

## 14. Urutan Implementasi

Kerjakan berurutan — setiap fase bisa di-test sebelum lanjut:

| Fase | Yang Dikerjakan | Cara Test |
|---|---|---|
| **1** | `docker-compose.yml` + `env.ts` + `.env` | `docker compose up`, curl localhost:9200 |
| **2** | `elasticsearch.ts` (client) + `elasticsearch.types.ts` + `elasticsearch.constants.ts` | `tsc --noEmit` |
| **3** | `ElasticsearchService.ensureIndex()` + `indexProduct()` + main.ts bootstrap | Start server, cek ES index di http://localhost:9200/products/_mapping |
| **4** | `ElasticsearchService.searchProducts()` | Unit test query DSL |
| **5** | Integrasi `product.service.ts` (write hooks) | Buat product → cek ES |
| **6** | Integrasi `product.service.ts` (read via ES) | `GET /api/product?search=kayu` |
| **7** | Reindex script | Jalankan script, cek count di ES |
| **8** | Graceful degradation | Matikan ES container, cek fallback |

---

## 15. Hal Penting yang Perlu Diketahui

### ES vs MongoDB — kapan pakai mana
| Use case | Pakai |
|---|---|
| Cari berdasarkan teks bebas (`search=...`) | **Elasticsearch** |
| Filter exact (design, color, dll) tanpa teks | **MongoDB (tetap)** |
| Get by ID | **MongoDB** |
| Pagination dengan filter saja | **MongoDB** |
| Pagination dengan search + filter | **ES untuk IDs, MongoDB untuk data** |

### Eventual consistency
ES bukan real-time. Setelah `indexProduct()` dipanggil, ada delay ~1 detik (default `refresh_interval`) sebelum dokumen muncul di search results. Untuk development ini fine. Untuk production, bisa di-set `refresh: "wait_for"` di index request jika butuh immediate consistency.

### Index vs Type
ES 7+ tidak lagi pakai `type` di dalam index. Satu index = satu tipe dokumen. Jadi index name kita langsung `penjualan_keramik_products`.

### `_id` di ES
ES punya `_id` sendiri. Kita menyimpan MongoDB `_id` sebagai field `mongoId` (keyword) untuk bisa query/delete berdasarkan Mongo ID. Saat `deleteProduct(mongoId)`, kita delete by `term query` pada `mongoId`, bukan by ES `_id`.

---

## 16. File Structure Setelah Implementasi

```
src/
├── core/
│   ├── config/
│   │   ├── elasticsearch.ts         ← NEW: client singleton
│   │   └── env.ts                   ← MODIFIED: tambah ES vars
│   ├── constants/
│   │   └── elasticsearch.ts         ← NEW: INDEX_NAME, mapping, boosts
│   └── services/
│       └── elasticsearch/
│           ├── elasticsearch.service.ts   ← MODIFIED: implementasi penuh
│           ├── elasticsearch.types.ts     ← NEW: ProductESDocument
│           └── elasticsearch.reindex.ts  ← NEW: CLI reindex script
└── modules/
    └── product/
        ├── product.service.ts       ← MODIFIED: hooks + ES search
        └── product.repository.ts   ← MODIFIED: tambah findByIds
```
