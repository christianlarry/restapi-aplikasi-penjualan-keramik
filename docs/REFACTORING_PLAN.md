# Refactoring Plan — REST API Aplikasi Penjualan Toko Keramik

> Dokumen ini merupakan analisis profesional dari sudut pandang **Software Architecture & Software Engineering** atas codebase yang ada, beserta rencana refactoring yang konkret dan terstruktur.

---

## 1. Analisis Kondisi Saat Ini (As-Is)

### 1.1 Struktur Folder Saat Ini

```
src/
├── app.ts
├── main.ts
├── config/
├── constants/
├── controllers/
├── errors/
├── helpers/
├── interfaces/
├── middlewares/
├── models/
├── routes/
│   ├── private/
│   └── public/
├── services/
├── utils/
└── validations/
```

Arsitektur ini menggunakan pendekatan **Layer-based (Horizontal Slicing)**: setiap folder merepresentasikan satu layer teknis. Ini adalah titik awal yang umum dan wajar untuk proyek yang berkembang cepat.

---

### 1.2 Temuan & Masalah (Issues Found)

Berikut adalah daftar *code smells* dan pelanggaran prinsip arsitektur yang ditemukan, diurutkan dari yang paling kritis:

---

#### 🔴 Critical

**1. Tidak ada Repository Pattern — DB query bocor ke Service layer**

Di `product.service.ts`, logika query MongoDB bercampur langsung di dalam business logic:

```typescript
// ❌ product.service.ts — Service langsung memanggil driver DB
const products = await productModel().aggregate(pipeline).toArray() as Product[];
const total = await productModel().countDocuments(filterQuery);

// Bahkan ada yang bypass model sama sekali:
const getProductFilterOptionsCollection = () => {
  return getDb().collection<ProductFilterOptions>("product_filter_options");
};
```

**Dampak:** Service tidak bisa di-unit test tanpa MongoDB yang berjalan. Coupling antara business logic dan storage engine sangat tinggi.

---

**2. Fat Service / God Service**

`product.service.ts` memiliki **341 baris** dan melakukan terlalu banyak hal:
- CRUD operations (create, read, update, delete)
- Cache management (getOrSet, del, clearKeys)
- Filter options sync (`updateFilterOptionsFromProduct`)
- DTO transformation (`convertProductToResponseObj`)
- Delegation ke recommendation service

**Dampak:** Melanggar **Single Responsibility Principle (SRP)**. Sulit di-maintain dan di-test secara terisolasi.

---

**3. Cache key sebagai magic string yang tersebar**

Cache keys seperti `"products:list:"`, `"product:id:"`, `"product:filter_options"` didefinisikan sebagai *hardcoded string* di beberapa tempat dalam service:

```typescript
// ❌ Magic strings tersebar di berbagai fungsi
await cache.del(`product:id:${id}`);
await cache.del("product:filter_options");
await cache.clearKeys("products:list:*");
await cache.clearKeys("products:paginated:*");
```

**Dampak:** Jika prefix berubah, harus update di banyak tempat. Rawan typo yang silent.

---

#### 🟠 Major

**4. Validasi dipanggil di dalam Service, bukan di Controller/Middleware**

```typescript
// ❌ product.service.ts
const create = async (body: PostProduct) => {
  const product = validate<PostProduct>(postProductValidation, body); // ← validasi di service
  ...
};
```

**Dampak:** Melanggar **separation of concerns**. Service seharusnya menerima data yang sudah valid. Validasi adalah concern dari layer input (controller/middleware).

---

**5. `JWT_SECRET` diduplikasi di dua tempat**

```typescript
// ❌ auth.middleware.ts
const JWT_SECRET = process.env.JWT_SECRET || ""

// ❌ user.service.ts
const JWT_SECRET: string = process.env.JWT_SECRET || ""
```

Padahal sudah ada `config/env.ts`. **Dampak:** Perubahan environment variable harus dilakukan di banyak tempat.

---

**6. Route structure berdasarkan akses kontrol, bukan domain**

```
routes/
├── private/
│   ├── product.routes.ts   ← CRUD product
│   └── user.routes.ts
└── public/
    ├── product.routes.ts   ← GET product
    └── user.routes.ts
```

Satu resource (product) dipecah ke dua file berbeda. Ini mempersulit navigasi kode.
**Dampak:** Untuk memahami semua route yang dimiliki product, harus buka 2 file terpisah.

---

**7. `helpers/` bukan helper — ini sebenarnya Query Builder**

`productQuery.helper.ts` membangun MongoDB filter dan sort stage. Ini adalah logika *data access*, bukan *helper* generik.

---

#### 🟡 Minor

**8. `eslint-disable` untuk `any` di pipeline MongoDB**

```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pipeline: any[] = [...]
```

MongoDB driver mendukung typing yang proper menggunakan `Document[]` atau pipeline types.

---

**9. Inkonsistensi export style**

Beberapa service menggunakan named exports (`export const checkUserExist`), sementara yang lain menggunakan default export object (`export default { register, login }`).

---

**10. Nama file constants redundant**

`messages.strings.ts`, `validations.strings.ts` — suffix `.strings` tidak perlu karena sudah ada di dalam folder `constants/`.

---

## 2. Arsitektur Yang Diusulkan (To-Be)

### 2.1 Pendekatan: Modular Layered Architecture

Untuk project Express dengan skala ini, arsitektur yang paling tepat adalah **Modular Layered Architecture** — kombinasi dari:

- **Feature Modules**: Kode dikelompokkan berdasarkan *domain/fitur* (`product`, `user`, `upload`)
- **Layered Architecture dalam setiap module**: Setiap module tetap memiliki layer yang jelas (controller → service → repository)
- **Shared Core**: Cross-cutting concerns (config, errors, middlewares, utils) dipisah ke folder `core/`

Pendekatan ini memberikan:
- **Cohesion tinggi** — semua kode yang berhubungan dengan `product` ada di satu tempat
- **Coupling rendah** — antar-module tidak saling depend secara langsung
- **Scalability** — mudah menambahkan module baru tanpa menyentuh kode yang ada
- **Testability** — setiap layer bisa di-mock/test secara independen

---

### 2.2 Struktur Folder Target

```
src/
│
├── app.ts                          # Express app setup & middleware registration
├── main.ts                         # Server bootstrap & graceful shutdown
│
├── core/                           # Cross-cutting concerns (shared infrastructure)
│   ├── config/                     # External service configurations
│   │   ├── env.ts                  # Typed environment variables (single source of truth)
│   │   ├── mongodb.ts
│   │   ├── redis.ts
│   │   ├── pinecone.ts
│   │   ├── gemini.ts
│   │   └── logger.ts
│   │
│   ├── constants/                  # Shared string constants
│   │   ├── messages.ts             # Response messages
│   │   └── validations.ts          # Validation error messages
│   │
│   ├── errors/                     # Custom error classes
│   │   ├── AppError.ts             # Base error class (NEW)
│   │   ├── ResponseError.ts
│   │   └── ValidationError.ts
│   │
│   ├── middlewares/                # Express middlewares
│   │   ├── auth.middleware.ts
│   │   ├── error.middleware.ts
│   │   ├── rateLimiter.middleware.ts
│   │   └── upload.middleware.ts
│   │
│   ├── types/                      # Shared TypeScript types & interfaces
│   │   └── pagination.types.ts
│   │
│   └── utils/                      # Generic utility functions
│       ├── cache.ts
│       ├── response.ts
│       ├── queryFormatter.ts
│       ├── stringFormatter.ts
│       └── deleteFile.ts
│
├── modules/                        # Domain feature modules
│   │
│   ├── product/
│   │   ├── product.controller.ts   # HTTP layer: parse request, call service, send response
│   │   ├── product.service.ts      # Business logic only (orchestration)
│   │   ├── product.repository.ts   # NEW: Data access layer (all DB queries here)
│   │   ├── product.cache.ts        # NEW: Centralized cache key definitions & helpers
│   │   ├── product.routes.ts       # All product routes in one file
│   │   ├── product.validation.ts   # Zod schemas & inferred types
│   │   └── product.types.ts        # Product-specific interfaces (Product, ProductFilters, etc.)
│   │
│   ├── user/
│   │   ├── user.controller.ts
│   │   ├── user.service.ts
│   │   ├── user.repository.ts      # NEW
│   │   ├── user.routes.ts
│   │   ├── user.validation.ts
│   │   └── user.types.ts
│   │
│   ├── upload/
│   │   ├── upload.controller.ts
│   │   ├── upload.service.ts
│   │   └── upload.routes.ts
│   │
│   └── recommendation/             # AI-related domain
│       ├── recommendation.service.ts
│       ├── embedding.service.ts
│       └── productVector.service.ts
│
└── routes/
    └── index.ts                    # Root router: mounts all module routes
```

---

### 2.3 Diagram Alur Dependency

```
HTTP Request
     │
     ▼
[ Middleware ]  (auth, rateLimiter, upload)
     │
     ▼
[ Controller ]  (parse & validate request input)
     │
     ▼
[ Service ]     (business logic & orchestration)
     │
     ▼
[ Repository ]  (data access — MongoDB queries)
     │
     ▼
[ Database ]    (MongoDB / Redis)
```

Setiap layer hanya boleh berkomunikasi dengan layer di bawahnya. **Controller tidak boleh memanggil Repository langsung.**

---

## 3. Rencana Refactoring Bertahap

Refactoring dilakukan secara *incremental* untuk menghindari breaking changes.

---

### Phase 1 — Structural Reorganization (Low Risk)

**Tujuan:** Reorganisasi folder tanpa mengubah logika.

- [ ] Buat folder `src/core/` dan pindahkan `config/`, `constants/`, `errors/`, `middlewares/`, `utils/`
- [ ] Buat folder `src/modules/` dan buat sub-folder per domain
- [ ] Pindahkan `interfaces/` ke dalam masing-masing module (`product.types.ts`, `user.types.ts`)
- [ ] Rename `messages.strings.ts` → `messages.ts` dan `validations.strings.ts` → `validations.ts`
- [ ] Buat `src/routes/index.ts` sebagai root router
- [ ] Update semua path alias `@/` agar sesuai struktur baru

---

### Phase 2 — Repository Pattern (High Impact)

**Tujuan:** Pisahkan data access logic dari business logic.

Buat `product.repository.ts`:

```typescript
// src/modules/product/product.repository.ts
import { getDb } from "@/core/config/mongodb";
import { ObjectId, Filter, Document } from "mongodb";
import { Product } from "./product.types";

const collection = () => getDb().collection<Product>("products");

const findMany = async (pipeline: Document[]): Promise<Product[]> => {
  return collection().aggregate(pipeline).toArray() as Promise<Product[]>;
};

const findById = async (id: ObjectId): Promise<Product | null> => {
  return collection().findOne({ _id: id });
};

const findOne = async (filter: Filter<Product>): Promise<Product | null> => {
  return collection().findOne(filter);
};

const insertOne = async (data: Omit<Product, "_id">): Promise<Product | null> => {
  const result = await collection().insertOne(data as Product);
  return collection().findOne({ _id: result.insertedId });
};

const findOneAndUpdate = async (
  id: ObjectId,
  update: Partial<Product>
): Promise<Product | null> => {
  return collection().findOneAndUpdate(
    { _id: id },
    { $set: update },
    { returnDocument: "after" }
  );
};

const findOneAndDelete = async (id: ObjectId): Promise<Product | null> => {
  return collection().findOneAndDelete({ _id: id });
};

const countDocuments = async (filter: Filter<Product>): Promise<number> => {
  return collection().countDocuments(filter);
};

const distinct = async <T>(field: string): Promise<T[]> => {
  return collection().distinct(field) as Promise<T[]>;
};

export const productRepository = {
  findMany,
  findById,
  findOne,
  findOneAndUpdate,
  findOneAndDelete,
  insertOne,
  countDocuments,
  distinct,
};
```

---

### Phase 3 — Cache Key Centralization (Medium Impact)

**Tujuan:** Eliminasi magic strings untuk cache keys.

Buat `product.cache.ts`:

```typescript
// src/modules/product/product.cache.ts
import * as cache from "@/core/utils/cache";

// --- Key Factories ---
export const ProductCacheKeys = {
  byId: (id: string) => `product:id:${id}`,
  list: (params: object) => `products:list:${JSON.stringify(params)}`,
  paginated: (params: object) => `products:paginated:${JSON.stringify(params)}`,
  filterOptions: () => `product:filter_options`,
  allListPattern: () => `products:list:*`,
  allPaginatedPattern: () => `products:paginated:*`,
};

// --- Invalidation Helper ---
export const invalidateProductCaches = async (id?: string) => {
  const tasks: Promise<void>[] = [
    cache.del(ProductCacheKeys.filterOptions()),
    cache.clearKeys(ProductCacheKeys.allListPattern()),
    cache.clearKeys(ProductCacheKeys.allPaginatedPattern()),
  ];

  if (id) {
    tasks.push(cache.del(ProductCacheKeys.byId(id)));
  }

  await Promise.all(tasks);
};
```

Service kemudian cukup memanggil:

```typescript
// ✅ Sebelumnya: 4 baris magic strings
// ✅ Sekarang: 1 baris yang jelas
await invalidateProductCaches(id);
```

---

### Phase 4 — Pindahkan Validasi ke Controller Layer (Medium Impact)

**Tujuan:** Service hanya menerima data yang sudah tervalidasi.

```typescript
// ❌ Sebelumnya di product.service.ts
const create = async (body: PostProduct) => {
  const product = validate<PostProduct>(postProductValidation, body); // validasi di service
  ...
};

// ✅ Sesudah di product.controller.ts
const add = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = validate<PostProduct>(postProductValidation, req.body); // validasi di controller
    const result = await productService.create(body);
    responseOk(res, 201, result);
  } catch (err) {
    next(err);
  }
};

// ✅ Service sekarang murni business logic
const create = async (body: PostProduct) => {
  if (await productRepository.findOne({ name: body.name })) {
    throw new ValidationError([{ field: "name", message: messages.product.nameTaken }]);
  }
  // ... build document & insert
};
```

---

### Phase 5 — Unify Route Structure (Low Risk)

**Tujuan:** Satu file route per domain, akses kontrol via middleware lokal.

```typescript
// ✅ src/modules/product/product.routes.ts
import { Router } from "express";
import { authenticateToken } from "@/core/middlewares/auth.middleware";
import { apiGenAIRateLimiter } from "@/core/middlewares/rateLimiter.middleware";
import productController from "./product.controller";

const router = Router();

// Public routes
router.get("/", productController.getMany);
router.get("/filter-options", productController.getProductFilterOptions);
router.get("/:id", productController.get);
router.post("/recommendations", apiGenAIRateLimiter, productController.recommendProducts);

// Private routes (protected)
router.post("/", authenticateToken, productController.add);
router.put("/:id", authenticateToken, productController.update);
router.patch("/:id/flags", authenticateToken, productController.updateProductFlags);
router.patch("/:id/discount", authenticateToken, productController.updateProductDiscount);
router.delete("/:id", authenticateToken, productController.remove);

export default router;
```

---

### Phase 6 — Fix Config Duplication (Quick Win)

**Tujuan:** Satu source of truth untuk semua config.

```typescript
// ✅ src/core/config/env.ts — tambahkan JWT_SECRET
export const env = z.object({
  ...
  JWT_SECRET: z.string().min(1),
  ...
}).parse(process.env);

// ✅ auth.middleware.ts
import { env } from "@/core/config/env";
// Hapus: const JWT_SECRET = process.env.JWT_SECRET || ""
// Gunakan: env.JWT_SECRET
```

---

## 4. Perbandingan Before vs After

| Aspek | Sebelum | Sesudah |
|---|---|---|
| **Organisasi folder** | Layer-based (horizontal) | Modular (feature-based + layered) |
| **Data access** | Langsung di service | Repository pattern |
| **Cache keys** | Magic strings tersebar | Centralized `ProductCacheKeys` |
| **Validasi** | Di dalam service | Di controller layer |
| **Routes** | Split by public/private | Per-domain, middleware lokal |
| **Config** | Duplikasi (JWT_SECRET x2) | Single source: `env.ts` |
| **Testability** | Sulit (coupled to MongoDB) | Mudah (repository bisa di-mock) |
| **`product.service.ts`** | 341 baris, God Service | ~150 baris, orchestration only |

---

## 5. Aturan Arsitektur (Architecture Decision Records)

Setelah refactoring, berlakukan aturan berikut:

1. **Controller** hanya boleh: parse request, call validate(), call service, send response.
2. **Service** hanya boleh: business rules, orchestration antar-repository, throw domain errors.
3. **Repository** hanya boleh: query database, tidak ada business logic.
4. **Config** tidak boleh di-import oleh layer selain `core/` dan `modules/*/service` atau `repository`.
5. Tidak ada `process.env.*` di luar `core/config/env.ts`.
6. Tidak ada hardcoded cache key string di luar file `*.cache.ts`.
7. Setiap module harus self-contained — semua routes, types, validations ada di dalam folder module-nya.

---

## 6. Prioritas Eksekusi

| Prioritas | Phase | Effort | Impact |
|---|---|---|---|
| 1 | Phase 6 — Fix Config Duplication | 🟢 Rendah | 🟢 Quick Win |
| 2 | Phase 1 — Structural Reorganization | 🟡 Sedang | 🔵 Foundational |
| 3 | Phase 5 — Unify Route Structure | 🟢 Rendah | 🟡 Sedang |
| 4 | Phase 3 — Cache Key Centralization | 🟢 Rendah | 🟡 Sedang |
| 5 | Phase 4 — Validasi ke Controller | 🟡 Sedang | 🟠 Tinggi |
| 6 | Phase 2 — Repository Pattern | 🔴 Tinggi | 🔴 Transformatif |

---

> Dokumen ini dibuat pada **28 February 2026** berdasarkan analisis `src/` codebase versi saat ini.
