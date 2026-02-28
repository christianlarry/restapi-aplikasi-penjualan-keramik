# Recommendation Chat History — Implementation Plan

> Analisis dan rencana implementasi untuk upgrade fitur rekomendasi dari *stateless single-turn* menjadi *stateful multi-turn conversation with history*.

---

## 1. Analisis Masalah Saat Ini

### Cara kerja sekarang (stateless)

```
Client                          Server
  │                                │
  │  POST /api/product/            │
  │  recommendations               │
  │  { prompt: "..." }  ──────────►│
  │                                │  1. Build fresh `contents = [{ role:"user", ... }]`
  │                                │  2. Call Gemini (function calling loop)
  │                                │  3. Get response
  │                                │  4. DISCARD contents array ← masalah
  │  { message, products } ◄───────│
  │                                │
  │  POST /api/product/            │
  │  recommendations               │
  │  { prompt: "yang warna lain?" }│
  │  ─────────────────────────────►│
  │                                │  1. Build fresh `contents = [{ role:"user", ... }]`
  │                                │  → AI TIDAK TAHU "yang warna lain" merujuk ke apa!
```

AI tidak memiliki konteks dari percakapan sebelumnya. `contents` yang dibangun Gemini SDK (array multi-turn) dibuang setelah setiap request.

---

## 2. Apakah Perlu Collection Baru?

**Ya — perlu satu collection baru: `chat_sessions`.**

Berikut perbandingan opsi storage:

| Opsi | Description | Pro | Kontra |
|---|---|---|---|
| **MongoDB** `chat_sessions` ✅ | Simpan history di collection baru | Persisten, queryable, TTL otomatis | Slightly slower read/write |
| Redis only | Simpan di Redis sebagai JSON | Sangat cepat | Data hilang jika Redis restart, TTL sulit dikelola untuk data besar |
| Hybrid (Redis cache + MongoDB) | Redis untuk session aktif, MongoDB untuk persistence | Optimal performance | Complexity tinggi, overkill untuk use case ini |

**Rekomendasi: MongoDB saja.**

Alasannya:
1. Session history bisa cukup besar (array Contents dengan function call turns)
2. Redis memory terbatas dan session bisa expire di waktu yang tidak tepat
3. MongoDB TTL index memberikan auto-delete yang reliable
4. Bisa di-query untuk analytics (berapa session per hari, dll)

---

## 3. MongoDB Schema — `chat_sessions`

```typescript
interface ChatSession {
  _id: ObjectId

  // ID yang dikirim ke client (UUID string, lebih aman dari ObjectId)
  sessionId: string

  // Full Gemini `contents` array — termasuk function call turns (internal AI context)
  // Ini yang di-feed kembali ke Gemini di turn berikutnya
  contents: GeminiContent[]

  // History yang bersih untuk ditampilkan ke client (user text + model text saja)
  // Tidak include function call/response turns (itu internal AI mechanics)
  displayHistory: ChatTurn[]

  // Produk yang dikembalikan di turn TERAKHIR (untuk referensi client)
  lastProducts: GetProductResponse[]

  // Timestamps
  createdAt: Date
  updatedAt: Date

  // Auto-delete setelah 24 jam sejak updatedAt (MongoDB TTL index)
  expiresAt: Date
}

interface ChatTurn {
  role: "user" | "assistant"
  text: string
  products?: GetProductResponse[]  // hanya ada di role "assistant" jika ada produk
  timestamp: Date
}
```

**TTL Index:**
```javascript
// Index MongoDB — otomatis hapus dokumen setelah expiresAt
db.chat_sessions.createIndex({ "expiresAt": 1 }, { expireAfterSeconds: 0 })
```

---

## 4. Desain API Baru

### Single endpoint, session-aware

```
POST /api/recommendations
```

**Request body:**
```json
{
  "prompt": "Saya cari keramik untuk kamar mandi",
  "sessionId": "abc-123-xyz"   ← opsional. tidak ada = buat session baru
}
```

**Response sukses:**
```json
{
  "data": {
    "sessionId": "abc-123-xyz",
    "message": "Hai! Untuk kamar mandi...",
    "products": [...],
    "history": [
      { "role": "user", "text": "Saya cari keramik untuk kamar mandi", "timestamp": "..." },
      { "role": "assistant", "text": "Hai! Untuk kamar mandi...", "products": [...], "timestamp": "..." }
    ]
  }
}
```

**Response jika session tidak ditemukan (expired/invalid):**
```json
{
  "error": {
    "message": "Chat session not found or expired. Start a new conversation."
  }
}
```
→ Client harus start ulang tanpa `sessionId`.

### Endpoint tambahan (opsional — untuk frontend)

```
GET /api/recommendations/:sessionId/history
```
— Ambil history session tanpa mengirim prompt baru. Berguna saat user reload halaman.

```
DELETE /api/recommendations/:sessionId
```
— Hapus session secara eksplisit (misal user klik "Mulai Chat Baru").

---

## 5. Alur Kerja Baru

```
Client                              Server
  │                                   │
  │  POST /api/recommendations        │
  │  { prompt: "cari keramik lantai" }│
  │  ────────────────────────────────►│
  │                                   │  1. sessionId tidak ada → buat session baru
  │                                   │  2. contents = [{ role:"user", text: prompt }]
  │                                   │  3. Jalankan Gemini function-calling loop
  │                                   │  4. Simpan contents (full) + displayHistory ke MongoDB
  │  { sessionId, message, products, ◄│
  │    history }                       │
  │                                   │
  │  POST /api/recommendations        │
  │  {                                │
  │    sessionId: "abc-123",          │
  │    prompt: "yang warna putih?"    │
  │  }  ─────────────────────────────►│
  │                                   │  1. Load session dari MongoDB by sessionId
  │                                   │  2. contents = session.contents  ← history!
  │                                   │  3. Append { role:"user", text: "yang warna putih?" }
  │                                   │  4. Jalankan Gemini dengan contents yang ada history
  │                                   │     → AI tahu konteks dari turn sebelumnya!
  │                                   │  5. Update session di MongoDB (contents + displayHistory)
  │  { sessionId, message, products, ◄│
  │    history (semua turn) }         │
```

---

## 6. Struktur File Baru

```
src/modules/recommendation/
│
├── gemini.service.ts           ← DIMODIFIKASI: terima `existingContents` sebagai parameter
│
├── chat/                       ← FOLDER BARU
│   ├── chat.types.ts           ← Interface ChatSession, ChatTurn, GeminiContent
│   ├── chat.repository.ts      ← MongoDB CRUD untuk chat_sessions
│   ├── chat.service.ts         ← Business logic: create/continue session
│   ├── chat.controller.ts      ← HTTP layer
│   └── chat.routes.ts          ← Route definitions
│
├── embedding.service.ts        ← tidak berubah
├── productVector.service.ts    ← tidak berubah
└── recommendation.service.ts   ← tidak berubah
```

**Mount route baru di `src/routes/index.ts`:**
```typescript
import chatRoutes from "@/modules/recommendation/chat/chat.routes"
router.use("/recommendations", chatRoutes)
```

---

## 7. Perubahan pada `gemini.service.ts`

Satu perubahan kunci: fungsi `getProductRecommendations` menerima parameter `existingContents` opsional.

```typescript
// SEBELUM
const getProductRecommendations = async (prompt: string) => {
  const contents: ContentListUnion = [
    { role: "user", parts: [{ text: prompt }] }
  ]
  // ...
}

// SESUDAH — existingContents di-inject dari session
const getProductRecommendations = async (
  prompt: string,
  existingContents: Content[] = []
) => {
  // Load history dari session + append prompt baru
  const contents: ContentListUnion = [
    ...existingContents,
    { role: "user", parts: [{ text: prompt }] }
  ]
  // ...
  // Return contents setelah loop selesai (untuk disimpan ke session)
  return { message, products, updatedContents: contents }
}
```

---

## 8. Cara Kerja `contents` di Gemini SDK (Detail Teknis)

Ini penting untuk dipahami sebelum implementasi.

Satu percakapan multi-turn terlihat seperti ini di dalam `contents`:

```
Turn 1:
  [0] { role: "user",  parts: [{ text: "cari keramik lantai kamar mandi" }] }
  [1] { role: "model", parts: [{ functionCall: { name: "getProductRecommendations", args: {...} } }] }
  [2] { role: "user",  parts: [{ functionResponse: { name: "...", response: {...} } }] }
  [3] { role: "model", parts: [{ text: "Hai! Nih rekomendasi untuk kamar mandi..." }] }

Turn 2 (setelah user kirim prompt baru):
  [4] { role: "user",  parts: [{ text: "yang warna putih ada?" }] }
  [5] { role: "model", parts: [{ functionCall: { name: "getProductRecommendations", args: {...} } }] }
  [6] { role: "user",  parts: [{ functionResponse: { name: "...", response: {...} } }] }
  [7] { role: "model", parts: [{ text: "Ada! Ini yang warna putih..." }] }
```

**Yang disimpan di MongoDB** → semua turns [0..7] (termasuk function call turns — itu yang dibutuhkan Gemini untuk context)

**Yang ditampilkan ke client** (`displayHistory`) → hanya:
```
[0] { role: "user",      text: "cari keramik lantai kamar mandi" }
[1] { role: "assistant", text: "Hai! Nih rekomendasi...", products: [...] }
[2] { role: "user",      text: "yang warna putih ada?" }
[3] { role: "assistant", text: "Ada! Ini yang warna putih...", products: [...] }
```

---

## 9. Batasan & Safeguards yang Perlu Diimplementasi

| Safeguard | Nilai Rekomendasi | Alasan |
|---|---|---|
| **Session TTL** | 24 jam (reset setiap turn) | Cukup untuk satu sesi belanja, tidak terlalu boros storage |
| **Max turns per session** | 20 turns | Gemini token limit (~1M tokens tapi function call overhead besar) |
| **Max `contents` size** | 500KB per dokumen | MongoDB 16MB limit, tapi besar contents = lambat |
| **Rate limit per session** | Ikut rate limiter yang ada (10 req/15min) | Sudah tersedia `apiGenAIRateLimiter` |
| **Session tidak ditemukan** | Return 404, jangan auto-create | Client harus sadar session-nya expired |

---

## 10. Urutan Implementasi

| Step | File | Aksi |
|---|---|---|
| 1 | `chat/chat.types.ts` | Definisikan `ChatSession`, `ChatTurn` |
| 2 | `chat/chat.repository.ts` | CRUD MongoDB + buat TTL index |
| 3 | `gemini.service.ts` | Modifikasi: terima + return `contents` |
| 4 | `chat/chat.service.ts` | Orchestrate create/continue session |
| 5 | `chat/chat.controller.ts` | HTTP parse + call service |
| 6 | `chat/chat.routes.ts` | Route definitions |
| 7 | `routes/index.ts` | Mount route baru |
| 8 | `product.routes.ts` | Hapus `recommendations` endpoint lama |

---

> Dokumen ini dibuat pada **28 February 2026** sebagai rencana implementasi fitur chat session untuk modul recommendation.
