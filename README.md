# REST API — Aplikasi Penjualan Toko Keramik

REST API backend untuk aplikasi penjualan dan kebutuhan keramik. Dibangun dengan Express.js + TypeScript dan dilengkapi fitur rekomendasi produk berbasis AI (Google Gemini).

---

## Tech Stack

| Layer | Teknologi |
|---|---|
| Runtime | Node.js + TypeScript |
| Framework | Express.js |
| Database | MongoDB (native driver) |
| Cache | Redis (ioredis) |
| AI Recommendation | Google Gemini (`gemini-2.5-flash`) |
| Vector Search | Pinecone |
| Auth | JWT (jsonwebtoken) + bcrypt |
| Validation | Zod |
| Image Processing | Sharp + Multer |
| Logging | Winston + Morgan |

---

## Fitur Utama

- **Manajemen Produk** — CRUD produk keramik lengkap dengan filter (desain, warna, tekstur, finishing, ukuran, harga)
- **Autentikasi** — Register & login dengan JWT
- **Upload Gambar** — Upload & resize gambar produk dengan Sharp
- **Rekomendasi AI (Chat)** — Rekomendasi produk berbasis percakapan multi-turn menggunakan Gemini function calling. Mendukung session history yang persisten (24 jam TTL)
- **Vector Search** — Embedding produk dan pencarian berbasis kemiripan via Pinecone
- **Caching** — Response caching dengan Redis untuk query produk
- **Rate Limiting** — Pembatasan request untuk endpoint umum dan endpoint AI

---

## Arsitektur

Proyek menggunakan **Modular Layered Architecture** dengan pemisahan antara concerns lintas-modul (`core/`) dan fitur domain (`modules/`).

```
src/
├── app.ts                        # Express setup & middleware
├── main.ts                       # Server entry point & graceful shutdown
│
├── core/                         # Cross-cutting concerns
│   ├── config/                   # env, mongodb, redis, gemini, pinecone, logger
│   ├── errors/                   # AppError, ResponseError, ValidationError
│   ├── middlewares/              # auth, error handler, rate limiter, upload
│   ├── types/                    # Shared types (pagination, dll)
│   └── utils/                    # response, validate, queryFormatter, dll
│
├── modules/                      # Domain modules
│   ├── product/                  # Controller → Service → Repository
│   │   ├── product.controller.ts
│   │   ├── product.service.ts
│   │   ├── product.repository.ts
│   │   ├── product.cache.ts      # Cache key factory & invalidation
│   │   ├── product.query.ts      # MongoDB filter/sort builder
│   │   ├── product.validation.ts
│   │   ├── product.types.ts
│   │   └── product.routes.ts
│   │
│   ├── user/                     # Controller → Service → Repository
│   │
│   ├── upload/                   # Image upload & processing
│   │
│   └── recommendation/           # AI recommendation
│       ├── gemini.service.ts     # Gemini function-calling loop
│       ├── embedding.service.ts
│       ├── productVector.service.ts
│       ├── recommendation.service.ts
│       └── chat/                 # Stateful chat session
│           ├── chat.types.ts
│           ├── chat.repository.ts
│           ├── chat.service.ts
│           ├── chat.controller.ts
│           └── chat.routes.ts
│
└── routes/
    └── index.ts                  # Root router — mount all modules
```

---

## Prasyarat

- Node.js v20+
- Docker & Docker Compose (untuk Redis)
- MongoDB Atlas atau instance MongoDB lokal
- Google AI API Key ([aistudio.google.com](https://aistudio.google.com))
- Pinecone API Key ([pinecone.io](https://pinecone.io))

---

## Instalasi & Menjalankan

### 1. Clone & Install Dependencies

```bash
git clone <repo-url>
cd restapi-aplikasi-penjualan-toko-keramik
npm install
```

### 2. Konfigurasi Environment

Buat file `.env` di root proyek:

```env
NODE_ENV=development
PORT=3000

# MongoDB
MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net
MONGODB_DB_NAME=toko_keramik

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT
JWT_SECRET=your-super-secret-key
JWT_ACCESS_EXPIRATION_MINUTE=60

# Pinecone
PINECONE_API_KEY=your-pinecone-api-key
PINECONE_INDEX=your-index-name

# Google Gemini
GOOGLE_API_KEY=your-google-api-key

# Frontend URL (untuk CORS, dll)
MAIN_APP_BASE_URL=http://localhost:5173
```

### 3. Jalankan Layanan Pendukung (Redis)

```bash
npm run dev:services
```

### 4. Jalankan Server (Development)

```bash
npm run dev
```

Server berjalan di `http://localhost:3000`.

---

## Scripts

| Script | Deskripsi |
|---|---|
| `npm run dev` | Jalankan server development dengan nodemon + hot reload |
| `npm run build` | Kompilasi TypeScript ke `dist/` |
| `npm start` | Jalankan dari hasil build (`dist/main.js`) |
| `npm run dev:services` | Jalankan Redis via Docker Compose |
| `npm run dev:services:down` | Matikan Docker services |
| `npm run dev:services:logs` | Lihat logs Docker services |

---

## API Endpoints

### Health Check

```
GET /health
```

### Produk

| Method | Endpoint | Auth | Deskripsi |
|---|---|---|---|
| `GET` | `/api/product` | — | Ambil daftar produk (filter & pagination) |
| `GET` | `/api/product/filter-options` | — | Ambil opsi filter tersedia |
| `GET` | `/api/product/:id` | — | Ambil detail produk |
| `POST` | `/api/product` | ✅ | Tambah produk baru |
| `PUT` | `/api/product/:id` | ✅ | Update produk |
| `PATCH` | `/api/product/:id/flags` | ✅ | Update flag (best seller, new arrivals) |
| `PATCH` | `/api/product/:id/discount` | ✅ | Update diskon |
| `DELETE` | `/api/product/:id` | ✅ | Hapus produk |

**Query params `GET /api/product`:**

```
?search=        Pencarian teks bebas
?design=        Filter desain (bisa multiple: design=Modern&design=Minimalis)
?color=         Filter warna
?texture=       Filter tekstur
?finishing=     Filter finishing
?size=          Filter ukuran (format: 60x60)
?bestSeller=    true / false
?newArrivals=   true / false
?discounted=    true / false
?order_by=      price_asc | price_desc | name_asc | name_desc
?pagination_page=   Halaman (default: 1)
?pagination_size=   Ukuran per halaman (default: 10)
```

### User

| Method | Endpoint | Auth | Deskripsi |
|---|---|---|---|
| `POST` | `/api/user/register` | — | Registrasi akun baru |
| `POST` | `/api/user/login` | — | Login, mendapat JWT |

### Upload

| Method | Endpoint | Auth | Deskripsi |
|---|---|---|---|
| `POST` | `/api/upload/product/:id/image` | ✅ | Upload gambar produk |

### Rekomendasi AI (Chat)

| Method | Endpoint | Auth | Rate Limit | Deskripsi |
|---|---|---|---|---|
| `POST` | `/api/recommendations` | — | 10 req/15 mnt | Kirim prompt, dapatkan rekomendasi produk |
| `GET` | `/api/recommendations/:sessionId/history` | — | — | Ambil history percakapan |
| `DELETE` | `/api/recommendations/:sessionId` | — | — | Hapus session |

**Request `POST /api/recommendations`:**

```json
{
  "prompt": "Saya cari keramik putih matte untuk kamar mandi",
  "sessionId": "optional-uuid-jika-lanjut-percakapan"
}
```

**Response:**

```json
{
  "data": {
    "sessionId": "abc-123-xyz",
    "message": "Hai! Untuk kamar mandi saya rekomendasikan...",
    "products": [...],
    "history": [
      { "role": "user", "text": "Saya cari keramik...", "timestamp": "..." },
      { "role": "assistant", "text": "Hai! Untuk kamar mandi...", "products": [...], "timestamp": "..." }
    ]
  }
}
```

> **Session TTL:** 24 jam sejak percakapan terakhir. Maksimal 20 turn per session.

---

## Response Format

**Sukses:**

```json
{
  "data": { ... }
}
```

**Sukses dengan pagination:**

```json
{
  "data": [...],
  "page": {
    "size": 10,
    "total": 100,
    "totalPages": 10,
    "current": 1
  }
}
```

**Error:**

```json
{
  "error": {
    "message": "Pesan error",
    "errors": [...]
  }
}
```

---

## Struktur Database (MongoDB)

| Collection | Isi |
|---|---|
| `products` | Data produk keramik |
| `users` | Akun pengguna |
| `product_filter_options` | Opsi filter dinamis (desain, warna, dll) |
| `chat_sessions` | History percakapan AI (auto-delete 24 jam via TTL index) |

---

## Author

**Christian Larry**
