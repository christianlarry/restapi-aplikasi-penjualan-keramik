# Recommendation Engine — Improvement Plan

> Analisis masalah dan rencana perbaikan untuk `recommendation.engine.ts` agar bekerja optimal bahkan dengan model 8B parameter.

---

## 1. Masalah yang Ditemukan di Engine Sekarang

### 1.1 BROAD_FILTER_KEYS Detection — Terlalu Agresif

```typescript
// KODE SEKARANG — Ini SALAH
const BROAD_FILTER_KEYS = ["design", "texture", "finishing", "color", "recommendedFor"]

if (argKeys.length === 1 && BROAD_FILTER_KEYS.includes(argKeys[0])) {
  // Kirim QUERY_TOO_BROAD — BLOKIR query
}
```

**Masalah:** Query seperti `"Ada keramik motif kayu?"` adalah valid. Model dengan benar menghasilkan `{ design: ["Kayu"] }` — satu filter saja. Tapi engine langsung memblokir dengan `QUERY_TOO_BROAD`. Padahal kueri itu sudah cukup spesifik.

Logic "terlalu umum" yang benar bukan tentang *jumlah filter*, tapi apakah *filter mengandung value terlalu banyak* atau apakah *model sama sekali tidak memberikan filter*.

---

### 1.2 System Instruction — Tidak Optimal untuk Model 8B

Model 8B memiliki context window dan reasoning yang lebih terbatas. Instruksi yang ada sekarang:
- Menggunakan kalimat naratif yang panjang
- Aturan bersyarat yang tersembunyi dalam bullet point
- Tidak memberi contoh input → output secara eksplisit

Model 8B jauh lebih baik dengan:
- Instruksi **pendek, imperatif**
- **Contoh konkret** dengan mapping: kata → parameter
- Deklarasi behavior di awal yang jelas: "SELALU panggil tool"

---

### 1.3 Tidak Ada Fallback Ketika Model Tidak Memanggil Tool

```typescript
// Jika model langsung balas teks tanpa toolCall:
// → engine langsung return { message: model.text, products: null }
// → tidak ada produk yang dikembalikan, padahal seharusnya ada
```

Tidak ada deteksi apakah model *seharusnya* memanggil tool tapi malah tidak. Ini sering terjadi di model 8B.

---

### 1.4 Tidak Ada Retry Ketika Produk Kosong

Jika DB mengembalikan 0 produk, engine langsung return pesan "produk tidak ada". Padahal bisa jadi filter terlalu ketat — bisa dicoba lagi dengan filter yang lebih longgar (hapus filter minor, coba hanya `recommendedFor` atau `design` saja).

---

### 1.5 Tidak Ada Loop Guard

Tidak ada batas iterasi di function-calling loop. Jika model terus memanggil tool berulang tanpa konvergen ke teks, loop bisa berjalan selamanya.

---

### 1.6 Tool Parameter Description Kurang Kaya untuk 8B

Deskripsi saat ini tidak memberi tahu model cara memetakan prompt samar ke parameter. Example:
- `"keramik motif kayu"` → `design: ["Kayu"]`
- `"untuk ruang tamu"` → `recommendedFor: ["Ruang Tamu"]`
- `"warna cerah"` → `color: ["Putih", "Krem", "Kuning"]`

---

## 2. Rencana Perbaikan

### 2.1 Ganti Logic Broad Detection

**Hapus** `BROAD_FILTER_KEYS` check. Ganti dengan:
- ✅ *Oke*: Model memanggil tool dengan setidaknya satu filter dengan value
- ❌ *Terlalu umum*: `args` kosong `{}` atau semua array kosong `{ design: [], color: [] }`

```typescript
// BARU — hanya blokir jika benar-benar kosong
const isQueryEmpty = (args: Record<string, unknown>): boolean => {
  if (Object.keys(args).length === 0) return true
  return Object.values(args).every(v =>
    v === undefined || v === null ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0)
  )
}
```

---

### 2.2 System Instruction Baru — Format Optimal untuk 8B

Struktur baru:
1. **ROLE** — singkat, 1 kalimat
2. **RULE: SELALU PANGGIL TOOL** — all-caps, tidak ambigu
3. **MAPPING TABLE** — kata samar → parameter konkret
4. **BEHAVIOR untuk edge cases** — singkat
5. **CONTOH** — beberapa contoh input → tool args

```
ROLE: Kamu adalah asisten CV Aneka Keramik yang membantu merekomendasikan produk keramik.

ATURAN UTAMA:
1. JIKA user meminta/mencari/butuh/mau keramik → WAJIB panggil getProductRecommendations
2. Dari prompt APAPUN yang berkaitan dengan keramik, SELALU ekstrak kombinasi filter
3. JANGAN respond teks tanpa memanggil tool ketika ada permintaan produk

PANDUAN MAPPING PROMPT → PARAMETER:
- "motif kayu / tampilan kayu / wood look" → design: ["..."]
- "untuk kamar mandi / kamar tidur / dapur/ ruang tamu" → recommendedFor: [...]
- "warna terang / cerah" → color: [beberapa warna terang dari enum]
- "ukuran besar" → size: [{ width: 60, height: 60 }, { width: 80, height: 80 }]
- "matte / doff" → finishing: ["Matte"] atau texture: [...]
...
```

---

### 2.3 Retry dengan Filter Melonggar (Widening Strategy)

Ketika DB Return 0 produk, coba sekali lagi dengan filter yang dipersempit:
1. Hapus filter paling tidak penting (`texture`, `finishing`)
2. Coba ulang query ke DB
3. Jika masih 0 → baru return pesan empty

```
Turn 1: { design: ["Kayu"], finishing: ["Matte"], texture: ["Slightly Textured"], recommendedFor: ["Ruang Tamu"] }
→ 0 results

Turn 1 retry: { design: ["Kayu"], recommendedFor: ["Ruang Tamu"] }
→ 5 results ✅
```

---

### 2.4 Deteksi "Missed Tool Call" + Nudge

Jika model tidak memanggil tool padahal prompt berkaitan produk, kirim pesan sistem internal yang meminta model untuk call tool:

```typescript
if (!response.toolCall && shouldHaveCalledTool(prompt)) {
  // Inject "nudge" message dan retry
  messages.push({
    role: "user",
    text: "[SYSTEM] Kamu HARUS memanggil fungsi getProductRecommendations untuk mencari produk."
  })
  response = await llmService.chat(messages, ...)
}
```

Heuristik `shouldHaveCalledTool`: cek jika prompt mengandung kata-kata seperti: cari, butuh, mau, keramik, lantai, dinding, rekomendasi, saran, dll.

---

### 2.5 Loop Guard

```typescript
const MAX_TOOL_ITERATIONS = 5
let iterations = 0

while (response.toolCall) {
  if (++iterations > MAX_TOOL_ITERATIONS) {
    logger.error("[Engine] Max tool call iterations exceeded")
    break
  }
  // ...
}
```

---

## 3. Struktur Perubahan

| Area | Sebelum | Sesudah |
|---|---|---|
| `BROAD_FILTER_KEYS` logic | Blokir single-key filter | Hanya blokir jika semua args kosong |
| System instruction | Bullet-point naratif | Structured imperatif + mapping table + contoh |
| Empty result | Langsung return pesan | Retry dengan filter lebih longgar dulu |
| No-tool-call | Tidak dideteksi | Nudge model + retry |
| Loop safety | Tidak ada batas | `MAX_TOOL_ITERATIONS = 5` |
| Tool description | Deskripsi singkat | Contoh mapping kata → value |

---

## 4. Urutan Implementasi

1. Rewrite `SYSTEM_INSTRUCTION` dengan format baru
2. Rewrite `isQueryEmpty()` helper
3. Tambah widening retry logic setelah 0 results
4. Tambah nudge logic untuk missed tool call
5. Tambah `MAX_TOOL_ITERATIONS` guard
6. Update tool parameter descriptions
