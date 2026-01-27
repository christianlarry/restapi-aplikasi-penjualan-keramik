# Blueprint Implementasi — REST API Aplikasi Penjualan Toko Keramik (Express + TS)

Dokumen ini menjelaskan *seluruh implementasi utama* pada codebase ini secara end-to-end (bootstrap server, modul domain, integrasi DB/cache/AI, hingga kontrak response/error). Tujuan utamanya: menjadi “blueprint” agar proyek yang sama bisa di-*rebuild* dengan teknologi lain (mis. **NestJS**) secara konsisten.

> Catatan: Sumber kebenaran kontrak API ada di `docs/openapi.yaml`. Dokumen ini fokus menjelaskan **bagaimana** API tersebut diimplementasikan di codebase (alur request, validasi, query DB, cache, dll).

---

## 1) Ringkasan Stack & Dependensi

**Runtime & framework**
- Node.js + TypeScript
- Express sebagai HTTP framework

**Database & cache**
- MongoDB native driver (`mongodb`)
- Redis (`ioredis`) untuk cache

**Auth & security**
- JWT (`jsonwebtoken`) untuk autentikasi
- Password hashing: `bcrypt`
- Rate limiting: `express-rate-limit`

**Upload & image processing**
- Upload: `multer` (memory storage)
- Transform image: `sharp` (resize + convert ke `.webp`)

**AI / Recommendation**
- Google Gemini via `@google/genai`
- Pinecone (`@pinecone-database/pinecone`) untuk vector search

**Logging & tooling**
- `winston` logger
- `morgan` HTTP logger
- `dotenv` + `zod` untuk validasi env

**Build**
- `tsc` + `tsc-alias`

---

## 2) Perintah Menjalankan Aplikasi

Dari `package.json`:
- Dev: `npm run dev` (nodemon + tsconfig-paths)
- Build: `npm run build` (compile TS lalu rewrite path alias)
- Start production build: `npm run start` (node `dist/main.js`)

Path alias TypeScript didefinisikan di `tsconfig.json` (contoh `@/*` → `src/*`). Pada mode dev, alias di-resolve lewat `tsconfig-paths/register`.

---

## 3) Konfigurasi Environment Variables (Sumber Kebenaran)

Sumber kebenaran env ada di `src/config/env.ts` (Zod schema + fail-fast). Wajib tersedia:

**App**
- `NODE_ENV`: `development | production | test`
- `PORT`: string angka (akan di-parse ke number)

**MongoDB**
- `MONGODB_URI`
- `MONGODB_DB_NAME`

**Redis**
- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_PASSWORD` (opsional)

**JWT**
- `JWT_SECRET`
- `JWT_ACCESS_EXPIRATION_MINUTE`

**Pinecone**
- `PINECONE_API_KEY`
- `PINECONE_INDEX`

**Google Gemini**
- `GOOGLE_API_KEY`

**Frontend URL**
- `MAIN_APP_BASE_URL`

### Catatan penting: `.env.example` tidak sinkron
File `.env.example` saat ini tidak memuat sebagian variabel yang dipakai `env.ts` (mis. Redis + GOOGLE_API_KEY + MAIN_APP_BASE_URL + JWT_ACCESS_EXPIRATION_MINUTE). Saat re-implement di NestJS, gunakan daftar di atas sebagai referensi utama.

---

## 4) Bootstrap Server & Lifecycle

### 4.1 Entry point
- `src/main.ts` adalah entry point.
- Flow startup:
  1. Load env (dari import `env`)
  2. `connectToMongoDB()` (fail-fast ping)
  3. `app.listen(PORT)`

### 4.2 Express app setup
- `src/app.ts` membangun instance Express dan mendaftarkan middleware + routes.

**Top middleware**
- `express.json()`
- `express.urlencoded({ extended: true })`
- `express.static("public")` → file di `public/` bisa diakses langsung
- `cors()`
- `compression()`
- `morgan("dev"|"combined")` berdasarkan `NODE_ENV`

**Routing**
- Semua API berada di prefix `/api`
  - Public: `app.use("/api", publicRoutes)`
  - Private: `app.use("/api", authenticateToken, privateRoutes)`

**Health check**
- `GET /health` → `{ status: "ok" }`

**Bottom middleware**
- `errorMiddleware` untuk error handling global.

### 4.3 Graceful shutdown
Di `src/main.ts`:
- Listen `SIGTERM` & `SIGINT`
- `server.close()` lalu `disconnectFromMongoDB()` dan `disconnectRedis()`.

---

## 5) Struktur Folder & Tanggung Jawab

- `src/config/*`: konfigurasi env, koneksi MongoDB, Redis, Gemini, Pinecone, logger
- `src/routes/*`: deklarasi endpoint Express Router (public vs private)
- `src/controllers/*`: adaptor HTTP (ambil req params/body/query → panggil service → response)
- `src/services/*`: business logic inti (validasi, query Mongo, cache invalidation, integrasi AI)
- `src/models/*`: “repository” tipis: wrapper `getDb().collection<T>(name)`
- `src/middlewares/*`: auth JWT, error handler, rate limiter, upload multer
- `src/validations/*`: Zod schema + helper `validate()` yang melempar `ValidationError`
- `src/utils/*`: helper lintas modul (response wrapper, cache wrapper Redis, formatter query, dll)
- `src/helpers/*`: helper query Mongo (filter & sort stage)
- `docs/openapi.yaml`: spesifikasi OpenAPI lengkap

---

## 6) Format Response & Error Handling (Kontrak Global)

### 6.1 Response sukses
Helper: `src/utils/response.ts`
- Tanpa pagination:
  ```json
  { "data": <payload> }
  ```
- Dengan pagination:
  ```json
  {
    "data": <payload>,
    "page": { "size": 10, "total": 123, "totalPages": 13, "current": 1 }
  }
  ```

### 6.2 Error format
Masih di `src/utils/response.ts`:
```json
{ "error": { "message": "...", "errors": [ { "field": "...", "message": "..." } ] } }
```

### 6.3 Kelas error
- `ResponseError` (`src/errors/response.error.ts`) → punya `status`
- `ValidationError` (`src/errors/validation.error.ts`) extends `ResponseError` → `status=400` + `errors[]`

### 6.4 Global error middleware
`src/middlewares/error.middleware.ts`:
- Jika `ValidationError` → `400` + body berisi `errors`
- Jika `ResponseError` → status sesuai
- Selain itu → `500`

### 6.5 Validasi request
`src/validations/validation.ts`:
- Semua validasi menggunakan `zod.safeParse`.
- Jika gagal, error diformat jadi array `{ field, message }` lalu dilempar sebagai `ValidationError`.

---

## 7) Routing: Public vs Private

### 7.1 Public routes (`/api`)
Didefinisikan di `src/routes/public.routes.ts`:
- `/api/product` → `src/routes/public/product.routes.ts`
- `/api/user` → `src/routes/public/user.routes.ts`

Endpoint public:
- `GET /api/product` → list produk (filter/search/sort, opsional pagination)
- `GET /api/product/filter-options` → daftar opsi filter
- `GET /api/product/:id` → detail produk
- `POST /api/product/recommendations` → rekomendasi AI (rate-limited)
- `POST /api/user/login` → login

### 7.2 Private routes (`/api` + JWT)
Didefinisikan di `src/routes/private.routes.ts` dan dilindungi `authenticateToken`:
- `/api/product` → `src/routes/private/product.routes.ts`
- `/api/user` → `src/routes/private/user.routes.ts`
- `/api/upload` → `src/routes/private/upload.routes.ts`

Endpoint private:
- `POST /api/product` → create produk
- `PUT /api/product/:id` → update produk
- `PATCH /api/product/:id/flags` → update flag (bestSeller/newArrivals)
- `PATCH /api/product/:id/discount` → update diskon
- `DELETE /api/product/:id` → delete produk

- `POST /api/user/register` → registrasi user

- `POST /api/upload/product-image` → upload image produk

---

## 8) Auth JWT (Private Routes)

Implementasi: `src/middlewares/auth.middleware.ts`

Flow:
1. Ambil header `Authorization: Bearer <token>`
2. Jika token tidak ada → `401 Unauthorized`
3. `jwt.verify(token, JWT_SECRET)`
4. Setelah decode, sistem melakukan pengecekan bahwa user masih ada (anti token “user sudah dihapus”) via `checkUserExist(username)`.
5. Payload disimpan ke `req.user` (tipe `WithUserRequest`).

Catatan:
- Jika token invalid/expired → dilempar sebagai `403 Forbidden`.

---

## 9) Rate Limiting

Implementasi: `src/middlewares/rateLimiter.middleware.ts`
- `apiRateLimiter`: 100 req / 5 menit (tersedia tapi belum dipasang di `app.ts`)
- `apiGenAIRateLimiter`: 10 req / 15 menit → dipakai di `POST /api/product/recommendations`

---

## 10) MongoDB: Koneksi, Model, & Akses Data

### 10.1 Koneksi
Implementasi: `src/config/mongodb.ts`
- `connectToMongoDB()` membuat `MongoClient`, connect, pilih DB (`MONGODB_DB_NAME`), dan `ping`.
- Ada singleton state: `mongoClient`, `mongoDb`, dan `connectPromise` (hindari double connect)

### 10.2 Model (collection wrapper)
- `src/models/product.model.ts` → `products` collection
- `src/models/user.model.ts` → `users` collection

### 10.3 ObjectId validation
`src/utils/checkValidObjectId.ts`:
- `checkValidObjectId(id)` melempar `ResponseError(400)` jika invalid

---

## 11) Redis Cache: Pola, Key, TTL, Invalidation

Implementasi:
- Client: `src/config/redis.ts`
- Helper cache: `src/utils/cache.ts`

### 11.1 Pola get-or-set
`getOrSet(key, callback, ttl=3600)`:
1. Coba `GET key`
2. Jika hit → parse JSON & return
3. Jika miss → jalankan `callback()` (biasanya query DB)
4. Simpan `SETEX key ttl` jika data truthy

Jika Redis error, sistem fallback ke DB tanpa mematikan request.

### 11.2 Pattern key yang dipakai produk
Dari `src/services/product.service.ts`:
- List non-paginated: `products:list:<JSON of {searchQuery,filters,orderBy,limit}>`
- List paginated: `products:paginated:<JSON of {page,size,searchQuery,filters,orderBy}>`
- Detail: `product:id:<id>`
- Filter options: `product:filter_options`

TTL: 3600 detik (1 jam)

### 11.3 Cache invalidation saat write
Pada `create/update/patch/delete` produk:
- Hapus `product:id:<id>` (jika relevan)
- Hapus `product:filter_options`
- Clear pattern:
  - `products:list:*`
  - `products:paginated:*`

---

## 12) Domain: Product

### 12.1 Data model
Interface `Product` ada di `src/interfaces/products.interface.ts`.

Field penting:
- `name`, `description?`, `brand`, `price`, `discount?`, `tilesPerBox`
- `specification`:
  - `size: { width, height }`
  - `application: string[]`
  - `design: string`
  - `color: string[]`
  - `finishing: string`
  - `texture: string`
  - `isWaterResistant: boolean`
  - `isSlipResistant: boolean`
- Flags:
  - `isBestSeller?`
  - `isNewArrivals?`
- `image?` path relatif terhadap `public/`
- `recommended?: string[]` (kategori/area rekomendasi)

Response GET produk menambahkan field komputasi:
- `finalPrice = price - (price * discount/100)` jika diskon ada

### 12.2 Validasi input product (Zod)
`src/validations/product.validation.ts`:
- `postProductValidation` untuk create
- `putProductValidation` sama dengan post
- Normalisasi string tertentu menggunakan `capitalize()`
- `discount` dibatasi 0..100

### 12.3 Query filter/search/sort
#### Input query parser
Controller `getMany` (`src/controllers/product.controller.ts`) mem-parsing query:
- Array query: `design, texture, finishing, color, application` via `parseQueryArray`
- Size query: `size=60x60&size=40x40` via `parseQuerySizeToArray` menghasilkan `{width,height}[]`
- Boolean flags: `bestSeller`, `newArrivals`, `discounted`
- Search: `search` (string)
- Sort: `order_by` (`price_asc|price_desc|name_asc|name_desc`)

#### Filter builder & sort
`src/helpers/productQuery.helper.ts`:
- `getProductFilters(filters, searchQuery)` membangun MongoDB filter:
  - `$in` untuk array filter
  - `$or` untuk kombinasi size dan search regex ke beberapa field
  - `discounted` → `discount: { $gt: 0 }`
  - `price` range → `$gte/$lte`
- `getSortStage(orderBy)`
  - default sort: `createdAt desc`

#### Query pipeline (list)
`src/services/product.service.ts`:
- Jika tidak ada filter/search/sort/limit → `find().toArray()`
- Jika ada → `aggregate([ $match, $addFields finalPrice, $sort, $limit? ])`

#### Pagination
`getPaginated(page,size,...)`:
- pipeline: `$match` → `$addFields` → `$sort` → `$skip` → `$limit`
- total dihitung pakai `countDocuments(filterQuery)`

### 12.4 Filter options (collection terpisah)
Ada collection `product_filter_options`.

Flow:
- Saat `create/update/delete`, service memanggil `updateFilterOptionsFromProduct()`:
  - Mengambil `distinct()` dari field spesifikasi (design/application/texture/finishing/color/size)
  - Menulis (upsert) dokumen per tipe filter:
    - `{ type: "design", options: [{label,value}, ...] }`
    - dst.
- Endpoint `GET /api/product/filter-options` membaca collection ini.

### 12.5 Product controller ↔ service mapping
Controller: `src/controllers/product.controller.ts`
- `getMany` → `productService.getMany(...)` atau `productService.getPaginated(...)`
- `get` → `productService.get(id)`
- `getProductFilterOptions` → `productService.getProductFilterOptions()`
- `add` → `productService.create(body)`
- `update` → `productService.update(id, body)`
- `updateProductFlags` → `productService.updateProductFlags(id, {isBestSeller,isNewArrivals})`
- `updateProductDiscount` → `productService.updateProductDiscount(id, discount)`
- `remove` → `productService.remove(id)`

---

## 13) Domain: User

### 13.1 Data model
Interface `User` ada di `src/interfaces/user.interface.ts`:
- `firstName`, `lastName`, `username`, `password`, `role`, timestamps

### 13.2 Validasi user
`src/validations/user.validation.ts`:
- Register:
  - username 3..20
  - password min 6
  - role enum `admin|user`
- Login:
  - username 3..20
  - password min 6

### 13.3 Register
`src/services/user.service.ts`:
1. Validate input Zod
2. Cek `username` sudah ada (`checkUserExist`)
3. Hash password dengan bcrypt (salt rounds 10)
4. Insert ke `users` collection

### 13.4 Login
`src/services/user.service.ts`:
1. Validate input
2. Cari user by username
3. Compare password bcrypt
4. Generate JWT token berisi payload:
   - `_id, firstName, lastName, username, role`

Catatan implementasi:
- Expiry saat ini hard-coded `1 jam`.
- Service ini memakai `process.env.JWT_SECRET` langsung, tidak memakai `env.JWT_SECRET`.

---

## 14) Domain: Upload Product Image

### 14.1 Middleware upload
`src/middlewares/uploadProductImage.middleware.ts`:
- `multer.memoryStorage()` → file tidak ditulis oleh multer, tetapi ada di `req.file.buffer`
- `fileFilter` hanya menerima `.jpg .jpeg .png .webp`
- Direktori target dipastikan ada: `public/uploads/images/products`

### 14.2 Upload service
`src/services/upload.service.ts`:
Flow:
1. Validasi `productId` valid ObjectId
2. Pastikan produk ada
3. Jika produk punya `image` sebelumnya → delete file lama
4. Buat nama file baru berdasarkan nama produk + timestamp, output `.webp`
5. Proses dengan `sharp`:
   - resize 800x800 fit cover
   - output webp quality 80
   - simpan ke `public/uploads/images/products/<file>.webp`
6. Update field `image` pada dokumen produk (disimpan relatif terhadap `public/`)

### 14.3 Upload controller
`src/controllers/upload.controller.ts`:
- Validasi `productId` ada
- Validasi `req.file` ada
- Jika error setelah upload, controller menghapus file (defensive cleanup)

---

## 15) AI / Recommendation (Ada 2 Pendekatan)

Di codebase ini ada dua jalur rekomendasi:

### 15.1 Jalur A — Gemini Function Calling (dipakai endpoint)
Dipakai oleh `POST /api/product/recommendations` via `src/services/gemini.service.ts`.

Konsep:
- Sistem membuat *tool/function declaration* bernama `getProductRecommendations`.
- Enum untuk `design/texture/finishing/color/recommendedFor` diambil dinamis dari DB via `distinct()`.
- Model Gemini akan memutuskan memanggil tool dengan args filter.

Flow ringkas:
1. Terima `prompt` user
2. Siapkan `systemInstruction` (persona: asisten toko)
3. Minta Gemini generate content dengan tool function
4. Jika Gemini memanggil tool:
   - argumen dicek
   - jika terlalu umum (hanya 1 filter “broad”), balas status `QUERY_TOO_BROAD`
   - jika cukup spesifik → query produk lewat `productService.getMany(..., limit=10)`
5. Jika hasil produk kosong → balas salah satu message fallback
6. Jika ada produk → hasil query dikirim balik ke Gemini sebagai `functionResponse`
7. Return:
   - `message`: narasi rekomendasi dari Gemini
   - `products`: list produk hasil query

### 15.2 Jalur B — Embedding + Pinecone Vector Search (tersedia)
Ada di `src/services/recommendation.service.ts`.

Flow:
1. Validate prompt (min 1 char)
2. Buat embedding prompt dengan Gemini embedding model (`gemini-embedding-001`, dim 1024)
3. Query Pinecone `topK=5` include metadata
4. Buat context string dari metadata match
5. Minta Gemini generate narasi berdasarkan prompt + context
6. Ambil dokumen MongoDB berdasarkan `_id` hasil Pinecone untuk `suggestions`

Return:
- `message` (narasi)
- `suggestions` (produk dari MongoDB)

### 15.3 Sinkronisasi index Pinecone (Product Vector)
`src/services/productVector.service.ts` menyediakan:
- `upsert(product)`
- `update(product)`
- `remove(productId)`

Namun pemanggilan vector service saat create/update/delete produk **masih dikomentari** di `product.service.ts`.

Saat re-implement di NestJS, Anda perlu memutuskan:
- Apakah jalur vector search ingin diaktifkan penuh? Jika ya, panggil `upsert/update/remove` setiap ada perubahan produk.

---

## 16) Mapping Implementasi ke NestJS (Blueprint Porting)

Bagian ini adalah panduan translasi 1:1 dari arsitektur Express ke NestJS.

### 16.1 Susunan module yang disarankan
- `AppModule`
- `ConfigModule` (global) + schema validation (Zod atau Joi)
- `DatabaseModule` (MongoDB provider)
- `RedisModule` (Redis provider)
- `AuthModule`
- `ProductModule`
- `UserModule`
- `UploadModule`
- `AiModule` (Gemini + Pinecone)

### 16.2 Padanan konsep Express → NestJS
- `routes/*` → `@Controller()` + decorator `@Get/@Post/...`
- `controllers/*` → Nest Controller
- `services/*` → `@Injectable()` providers
- `middlewares/auth.middleware.ts` → `AuthGuard` (JWT) / `CanActivate`
- `error.middleware.ts` → `ExceptionFilter` global
- `validations/*` → `DTO + ValidationPipe` atau `ZodPipe`
- `utils/response.ts` → `Interceptor` untuk response shaping (opsional)
- `rateLimiter.middleware.ts` → `@nestjs/throttler` (disarankan) atau middleware
- `multer` middleware → `@UseInterceptors(FileInterceptor('image', multerOptions))`

### 16.3 Kontrak response di NestJS
Jika ingin mempertahankan format response yang sama:
- Buat global interceptor `ResponseTransformInterceptor`:
  - Jika handler return `{data, page?}` → langsung
  - Atau pakai wrapper standar: controller return data mentah, interceptor membungkus jadi `{ data }`

Untuk error:
- Buat `HttpExceptionFilter` yang:
  - Mapping error validasi → `{ error: { message, errors } }`
  - Mapping error domain → `{ error: { message } }`

### 16.4 MongoDB layer di NestJS
Anda bisa meniru pola sekarang (native driver) agar paling mirip:
- Provider `MongoClient` singleton
- Provider `Db` singleton
- Repository: `ProductsRepository`, `UsersRepository`, `ProductFilterOptionsRepository`

Atau pakai Mongoose/Prisma, tapi implementasi query agregasi & distinct perlu disesuaikan.

### 16.5 Cache layer di NestJS
Replikasi util `getOrSet/del/clearKeys`:
- Buat `CacheService` yang memakai Redis client
- Implement:
  - `getOrSet<T>(key, fn, ttlSec)`
  - `del(key)`
  - `clearKeys(pattern)` pakai `SCAN`
- Pertahankan key pattern yang sama agar behavior identik.

### 16.6 Auth JWT di NestJS
- `JwtStrategy` untuk decode token
- `JwtAuthGuard` untuk melindungi route private
- Setelah token valid, lakukan check “user masih ada” (call `UsersRepository.findByUsername`) sebelum allow.

### 16.7 Upload di NestJS
- Gunakan memory storage (agar bisa `sharp(file.buffer)`)
- Validasi extension/mime
- Simpan file `.webp` ke `public/uploads/images/products`
- Expose static files (Nest): `app.useStaticAssets(join(__dirname, '..', 'public'))`

### 16.8 AI di NestJS
Buat service:
- `GeminiService`:
  - `getProductRecommendations(prompt)` implement function calling seperti sekarang
  - `getEmbeddingFromText(text)`
- `PineconeService`:
  - `query(vector)`
  - `upsert/update/delete` untuk product vectors

Pisahkan endpoint:
- `POST /api/product/recommendations` tetap rate-limited (10/15m) via throttler.

---

## 17) Langkah Implementasi Ulang di NestJS (Step-by-step)

Urutan yang paling aman untuk re-build:

1. **Scaffold project NestJS**
   - `nest new <project>`
   - Setup TS path alias (opsional)

2. **Setup Config + env validation (fail-fast)**
   - Buat schema mengikuti daftar `src/config/env.ts`
   - Pastikan app tidak boot jika env invalid

3. **Setup MongoDB connection**
   - Provider `MongoClient` + `Db`
   - Pastikan ada `ping` saat startup
   - Implement graceful shutdown (`onModuleDestroy`)

4. **Setup Redis client + CacheService**
   - Implement `getOrSet`, `del`, `clearKeys`
   - Logging pada cache hit/miss

5. **Implement error model + global exception filter**
   - `ResponseError` (status + message)
   - `ValidationError` (errors array)
   - Global filter untuk format `{ error: ... }`

6. **Implement response wrapper (opsional)**
   - Interceptor agar response jadi `{ data }` dan pagination konsisten

7. **Implement Product domain**
   - Model interface/DTO setara dengan `Product`
   - Implement:
     - get list (aggregation + finalPrice)
     - pagination
     - get by id
     - create/update/delete + cache invalidation
     - patch flags
     - patch discount
     - filter options update (distinct + upsert ke `product_filter_options`)

8. **Implement User domain**
   - Register (bcrypt hash)
   - Login (bcrypt compare) + JWT sign

9. **Implement Auth guard**
   - Protect private controllers
   - Check user existence setelah decode

10. **Implement Upload**
   - `POST /api/upload/product-image`
   - memory file + sharp → `.webp`
   - update product.image

11. **Implement AI recommendation**
   - Jalur A: Gemini function calling + query DB
   - (Opsional) Jalur B: embedding + Pinecone + suggestions
   - Putuskan strategi indexing Pinecone:
     - aktifkan `upsert/update/remove` saat produk berubah

12. **Add rate limiter**
   - apply khusus endpoint AI: 10 req / 15 menit

13. **Expose OpenAPI/Swagger**
   - Pilihan 1: generate via decorators
   - Pilihan 2: gunakan `docs/openapi.yaml` sebagai referensi kontrak

---

## 18) Catatan Konsistensi & Hal yang Perlu Diputuskan Saat Porting

- **Env**: pastikan `.env.example` di Nest sinkron dengan schema.
- **JWT expiry**: code sekarang hard-coded 1 jam; ada env `JWT_ACCESS_EXPIRATION_MINUTE` namun belum dipakai.
- **Rate limiter global**: `apiRateLimiter` tersedia tapi belum dipasang.
- **Vector indexing**: `productVector.service.ts` tersedia, tapi pemanggilannya masih dikomentari. Jika ingin rekomendasi Pinecone akurat, indexing perlu diaktifkan.
- **Dokumen contoh**: `docs/mongodb.js` tidak merepresentasikan schema aktual (hanya contoh kasar).

---

## 19) Checklist Fitur (untuk verifikasi di NestJS)

- [ ] App boot fail-fast jika env invalid
- [ ] Mongo connect + ping + graceful shutdown
- [ ] Redis connect + cache getOrSet + invalidation
- [ ] Response format `{ data }` dan pagination `{ page }`
- [ ] Error format `{ error: { message, errors? } }`
- [ ] JWT auth untuk `/api/*` private
- [ ] CRUD product + patch flags + patch discount
- [ ] Filter/search/sort/pagination sesuai OpenAPI
- [ ] Filter options auto-update dari distinct values
- [ ] Upload product image → webp + resize 800 + replace old image
- [ ] AI recommendations endpoint + rate limiting

