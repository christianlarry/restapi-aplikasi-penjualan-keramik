/**
 * Provider-agnostic recommendation engine.
 *
 * This module owns the product recommendation business logic (function-calling
 * loop, broad-query detection, empty-result handling) and delegates the actual
 * LLM inference to whichever provider is configured via LLM_PROVIDER env var.
 */
import { llmService } from "@/core/services/llm/llm.factory"
import type { LLMMessage, LLMTool } from "@/core/types/llm.types"
import productService from "@/modules/product/product.service"
import { GetProductResponse, ProductFilters } from "@/modules/product/product.types"
import { logger } from "@/core/config/logger"

// ─── Exported result type ─────────────────────────────────────────────────────

export interface RecommendationResult {
  message: string | undefined
  products: GetProductResponse[] | null
  /** Full conversation history after this turn — persist in session */
  updatedMessages: LLMMessage[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Max function-calling loop iterations per turn — prevents infinite loops */
const MAX_TOOL_ITERATIONS = 5

/**
 * Keywords that indicate the user is asking for a product recommendation.
 * Used to detect when the model failed to call the tool but should have.
 */
const PRODUCT_INTENT_KEYWORDS = [
  "cari", "cariin", "butuh", "mau", "pengen", "ingin", "rekomen", "saran",
  "keramik", "lantai", "dinding", "kamar", "dapur", "ruang", "motif", "warna",
  "ukuran", "harga", "glossy", "matte", "kayu", "batu", "marble", "granit"
]

// ─── System instruction ───────────────────────────────────────────────────────

/**
 * System instruction optimized for small models (7B–8B).
 * Uses short imperative rules + explicit mapping table + concrete examples
 * to maximize tool-calling reliability across all providers.
 */
const buildSystemInstruction = (enumValues: {
  design: string[]
  texture: string[]
  finishing: string[]
  color: string[]
  recommendedFor: string[]
}): string => `
Kamu adalah asisten virtual toko "CV Aneka Keramik". Tugasmu: merekomendasikan produk keramik.

== ATURAN UTAMA ==
1. JIKA user meminta, mencari, butuh, atau menyebut keramik → WAJIB panggil getProductRecommendations
2. SELALU ekstrak kombinasi filter dari prompt, JANGAN pernah kirim args kosong
3. Dari deskripsi APAPUN, selalu bisa diterjemahkan ke kombinasi filter
4. Setelah dapat hasil produk, jelaskan dengan gaya casual dan berikan alasan relevansinya
5. JANGAN tanya balik. Berikan jawaban final langsung.

== NILAI YANG TERSEDIA ==
Design: ${enumValues.design.join(", ")}
Texture: ${enumValues.texture.join(", ")}
Finishing: ${enumValues.finishing.join(", ")}
Color: ${enumValues.color.join(", ")}
RecommendedFor: ${enumValues.recommendedFor.join(", ")}

== PANDUAN MAPPING PROMPT → FILTER ==
"motif kayu / tampilan kayu / wood look / woodgrain"
  → design: pilih nilai yang paling mirip "kayu" dari enum Design

"untuk kamar mandi / toilet / wc"
  → recommendedFor: pilih nilai relevan dari enum RecommendedFor

"untuk ruang tamu / living room"
  → recommendedFor: pilih nilai relevan dari enum RecommendedFor

"untuk dapur / kitchen"
  → recommendedFor: pilih nilai relevan dari enum RecommendedFor

"untuk kamar tidur / bedroom"
  → recommendedFor: pilih nilai relevan dari enum RecommendedFor

"warna terang / cerah / putih / pastel"
  → color: pilih beberapa warna terang dari enum Color

"warna gelap / hitam / abu / elegan"
  → color: pilih beberapa warna gelap dari enum Color

"matte / doff / tidak mengkilap"
  → finishing: pilih nilai "matte" atau serupa dari enum Finishing

"glossy / mengkilap / shiny"
  → finishing: pilih nilai "glossy" atau serupa dari enum Finishing

"ukuran besar / large / jumbo"
  → size: [{ width: 60, height: 60 }, { width: 80, height: 80 }, { width: 100, height: 100 }]

"ukuran sedang / medium"
  → size: [{ width: 40, height: 40 }, { width: 30, height: 60 }]

"ukuran kecil / small"
  → size: [{ width: 20, height: 20 }, { width: 25, height: 25 }, { width: 30, height: 30 }]

"modern / minimalis / clean look / skandinavia"
  → design: design modern/minimalis dari enum, color: putih/abu/netral, finishing: matte atau polished

"klasik / tradisional / antik / vintage"
  → design: design klasik dari enum, color: krem/coklat/gold

"natural / batu alam / stone look / concrete"
  → design: design natural/stone dari enum, texture: rough/uneven dari enum

"premium / mewah / luxury"
  → finishing: polished dari enum, texture: smooth, color: putih/gold/marble

== CONTOH ==
Prompt: "keramik motif kayu untuk ruang tamu"
→ { design: ["<nilai kayu dari enum>"], recommendedFor: ["<nilai ruang tamu dari enum>"] }

Prompt: "cari keramik kamar mandi warna putih glossy"
→ { recommendedFor: ["<nilai kamar mandi>"], color: ["<nilai putih>"], finishing: ["<nilai glossy>"] }

Prompt: "keramik lantai dapur yang anti slip"
→ { recommendedFor: ["<nilai dapur>"], texture: ["<nilai rough/textured/anti-slip>"] }

Prompt: "keramik modern minimalis warna netral ukuran besar"
→ { design: ["<nilai modern/minimalis>"], color: ["<nilai netral>"], size: [{ width: 60, height: 60 }, { width: 80, height: 80 }] }

== EDGE CASES ==
- Jika prompt samar seperti "keramik bagus" → tetap panggil tool dengan filter paling relevan yang bisa ditebak
- Jika harga disebutkan → gunakan parameter price
- Jika prompt tidak berhubungan dengan produk → jawab sopan bahwa kamu hanya bisa bantu rekomendasi produk
`.trim()

// ─── Empty args guard ─────────────────────────────────────────────────────────

/**
 * Returns true when the model produced an args object with no usable filter values.
 * A single specific filter is perfectly valid — we only reject truly empty calls.
 */
const isQueryEmpty = (args: Record<string, unknown>): boolean => {
  if (!args || Object.keys(args).length === 0) return true

  return Object.values(args).every(v => {
    if (v === undefined || v === null) return true
    if (Array.isArray(v)) return v.length === 0
    if (typeof v === "object") return Object.keys(v as object).length === 0
    return false
  })
}

// ─── Missed tool-call detection ───────────────────────────────────────────────

/**
 * Heuristic to detect when a user prompt likely needs a product search
 * but the model responded with text instead of calling the tool.
 */
const likelyProductIntent = (prompt: string): boolean => {
  const lower = prompt.toLowerCase()
  return PRODUCT_INTENT_KEYWORDS.some(kw => lower.includes(kw))
}

// ─── Widening retry ───────────────────────────────────────────────────────────

/**
 * Given a filter args object that returned 0 products, produce a broader version
 * by dropping the most restrictive secondary filters (texture, finishing, size).
 * Returns null if widening is not possible (no filters remain after stripping).
 */
const widenArgs = (args: Record<string, unknown>): Record<string, unknown> | null => {
  const SECONDARY_FILTERS = ["texture", "finishing", "size"]
  const widened = { ...args }

  for (const key of SECONDARY_FILTERS) {
    delete widened[key]
  }

  // If nothing useful remains, return null
  if (isQueryEmpty(widened)) return null
  // If widened equals original (no secondary filters were present), return null
  if (Object.keys(widened).length === Object.keys(args).length) return null

  return widened
}

// ─── Token budget ───────────────────────────────────────────────────────────────

/**
 * Rough token estimator: ~4 characters per token (covers mixed Indonesian/English).
 * We stay conservative so we never hit the API hard limit.
 */
const MAX_HISTORY_TOKENS = 4000

const estimateMessageTokens = (msg: LLMMessage): number => {
  const texts: string[] = []
  if (msg.text) texts.push(msg.text)
  if (msg.toolCall) texts.push(JSON.stringify(msg.toolCall))
  if (msg.toolResult) texts.push(JSON.stringify(msg.toolResult))
  return Math.ceil(texts.join("").length / 4)
}

/**
 * Trim the messages array from the front until the total estimated token count
 * is within MAX_HISTORY_TOKENS. Always ensures the first remaining message is a
 * user-role message so the conversation context stays valid.
 */
const trimMessagesToTokenLimit = (messages: LLMMessage[]): LLMMessage[] => {
  const total = messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0)
  if (total <= MAX_HISTORY_TOKENS) return messages

  const trimmed = [...messages]

  while (
    trimmed.reduce((sum, m) => sum + estimateMessageTokens(m), 0) > MAX_HISTORY_TOKENS
    && trimmed.length > 2
  ) {
    trimmed.shift()
    // Skip any orphaned non-user messages at the head to keep structure valid
    while (trimmed.length > 1 && trimmed[0].role !== "user") trimmed.shift()
  }

  logger.warn(
    `[Engine] History trimmed: ${messages.length} → ${trimmed.length} messages ` +
    `(~${trimmed.reduce((s, m) => s + estimateMessageTokens(m), 0)} tokens)`
  )
  return trimmed
}

// ─── Fallback search ─────────────────────────────────────────────────────────

/**
 * Progressive fallback when the exact query returns 0 products.
 * Tries increasingly broad strategies and returns as soon as ≥1 product found.
 *
 * Level 1 — single primary filter in order of specificity: recommendedFor, design, color
 * Level 2 — best sellers (no filter)
 * Level 3 — any products (guaranteed non-empty if DB has data)
 */
const fallbackSearch = async (
  args: Record<string, unknown>
): Promise<GetProductResponse[]> => {
  type FilterEntry = [ProductFilters, string]

  const candidates: FilterEntry[] = []

  if (args.recommendedFor && (args.recommendedFor as string[]).length > 0)
    candidates.push([{ recommended: args.recommendedFor as string[] }, "recommendedFor"])

  if (args.design && (args.design as string[]).length > 0)
    candidates.push([{ design: args.design as string[] }, "design"])

  if (args.color && (args.color as string[]).length > 0)
    candidates.push([{ color: args.color as string[] }, "color"])

  for (const [filter, label] of candidates) {
    const result = await productService.getMany(undefined, filter, undefined, 5)
    if (result.length > 0) {
      logger.info(`[Engine] Fallback hit on "${label}" → ${result.length} products`)
      return result
    }
  }

  // Level 2: best sellers
  const featured = await productService.getMany(undefined, { bestSeller: true }, undefined, 5)
  if (featured.length > 0) {
    logger.info(`[Engine] Fallback hit on bestSeller → ${featured.length} products`)
    return featured
  }

  // Level 3: any products (guaranteed if DB is non-empty)
  const any = await productService.getMany(undefined, {}, undefined, 5)
  logger.info(`[Engine] Fallback catch-all → ${any.length} products`)
  return any
}

// ─── Refusal detection ──────────────────────────────────────────────────────────

/**
 * Common refusal/inability phrases the model sometimes generates after receiving
 * product results. When detected alongside non-empty products, we suppress the
 * refusal and fall back to a canned handoff message.
 */
const REFUSAL_PATTERNS = [
  "tidak bisa membantu",
  "tidak dapat membantu",
  "saya tidak bisa",
  "saya tidak dapat",
  "maaf, tapi saya",
  "di luar kemampuan",
  "tidak memiliki kemampuan",
  "tidak bisa memberikan",
  "tidak dapat memberikan",
  "beyond my capabilities",
  "i cannot help",
  "i can't help",
  "unable to assist"
]

const isLikelyRefusal = (text: string | undefined): boolean => {
  if (!text) return false
  const lower = text.toLowerCase()
  return REFUSAL_PATTERNS.some(p => lower.includes(p))
}

// ─── Post-tool narration nudge ────────────────────────────────────────────────

/**
 * Injected as a user turn right before asking the model to narrate product results.
 * Explicit instruction dramatically improves small-model compliance.
 */
const NARRATE_PRODUCTS_NUDGE =
  "Produk sudah ditemukan. Sekarang jelaskan produk-produk tersebut kepada user dengan gaya casual dan berikan alasan mengapa produk itu cocok dengan permintaan mereka."

/**
 * Used when products come from the fallback search (not an exact match).
 * Tells the model to be transparent that these are alternative suggestions.
 */
const NARRATE_FALLBACK_NUDGE =
  "Produk yang dicari tidak ditemukan secara persis. Tapi kami menemukan produk alternatif yang mungkin relevan. Jelaskan kepada user bahwa ini adalah rekomendasi alternatif, sambil tetap menjelaskan keunggulan dan relevansi tiap produg dengan casual."

// ─── Empty product messages ───────────────────────────────────────────────────

const EMPTY_PRODUCT_MESSAGES = [
  "Waduh, maaf banget nih dari CV Aneka Keramik! Kayaknya produk yang kamu cari lagi sembunyi atau belum ada. Coba deh pakai kata kunci lain yang lebih umum, siapa tahu ketemu jodohnya! 😉",
  "Yah, sayang sekali! Produk dengan spek itu lagi kosong, nih. Tapi jangan khawatir, kami punya banyak koleksi lain yang nggak kalah keren. Coba cari dengan kata kunci berbeda, yuk!",
  "Hmm, sepertinya produk impianmu lagi nggak ada di stok kami. Maaf ya! Coba deh jelaskan kebutuhanmu dengan cara lain, mungkin aku bisa bantu carikan alternatif terbaik dari CV Aneka Keramik!",
  "Aduh, maaf ya, produk yang kamu maksud belum ketemu nih. Mungkin lagi di jalan atau speknya terlalu unik! Coba deh cari yang mirip-mirip, koleksi kami banyak banget lho!",
  "Maaf sekali dari CV Aneka Keramik, produknya belum tersedia saat ini. Tapi tenang, setiap hari ada aja yang baru di sini. Coba lagi dengan kata kunci lain atau cek lagi besok ya!"
]

// ─── Tool builder ─────────────────────────────────────────────────────────────

/** Build the product recommendation tool with live enum values from DB */
const buildProductTool = async (): Promise<{
  tool: LLMTool
  enumValues: {
    design: string[]
    texture: string[]
    finishing: string[]
    color: string[]
    recommendedFor: string[]
  }
}> => {
  const [design, texture, finishing, color, recommendedFor] = await Promise.all([
    productService.getDistinctValues("specification.design"),
    productService.getDistinctValues("specification.texture"),
    productService.getDistinctValues("specification.finishing"),
    productService.getDistinctValues("specification.color"),
    productService.getDistinctValues("recommended")
  ])

  const enumValues = { design, texture, finishing, color, recommendedFor }

  const tool: LLMTool = {
    name: "getProductRecommendations",
    description: "Cari produk keramik dari database berdasarkan filter. WAJIB dipanggil untuk setiap permintaan produk.",
    parameters: {
      type: "object",
      properties: {
        design: {
          type: "array",
          items: { type: "string", enum: design },
          description: `Desain/motif keramik. Tersedia: ${design.join(", ")}. Contoh: keramik kayu → design kayu dari list.`
        },
        texture: {
          type: "array",
          items: { type: "string", enum: texture },
          description: `Tekstur permukaan. Tersedia: ${texture.join(", ")}. Contoh: anti-slip → rough/textured.`
        },
        finishing: {
          type: "array",
          items: { type: "string", enum: finishing },
          description: `Finishing permukaan. Tersedia: ${finishing.join(", ")}. Contoh: glossy/mengkilap, matte/doff.`
        },
        color: {
          type: "array",
          items: { type: "string", enum: color },
          description: `Warna keramik. Tersedia: ${color.join(", ")}. Untuk "warna terang" pilih beberapa warna cerah.`
        },
        size: {
          type: "array",
          items: {
            type: "object",
            properties: {
              width: { type: "number", description: "Lebar dalam cm, misal 60" },
              height: { type: "number", description: "Tinggi dalam cm, misal 60" }
            }
          },
          description: 'Ukuran dalam cm. "besar" → [{width:60,height:60},{width:80,height:80}]. "kecil" → [{width:20,height:20},{width:30,height:30}].'
        },
        recommendedFor: {
          type: "array",
          items: { type: "string", enum: recommendedFor },
          description: `Area penggunaan. Tersedia: ${recommendedFor.join(", ")}. Contoh: "kamar mandi" → pilih nilai yang paling relevan.`
        },
        price: {
          type: "object",
          properties: {
            min: { type: "number", description: "Harga minimal (Rupiah). Default 0 jika tidak disebutkan." },
            max: { type: "number", description: "Harga maksimal (Rupiah). Default 999999999999 jika tidak disebutkan." }
          },
          description: "Filter harga. Hanya isi jika user menyebutkan harga."
        }
      }
    }
  }

  return { tool, enumValues }
}

// ─── Main engine ──────────────────────────────────────────────────────────────

/**
 * Run a recommendation turn.
 *
 * @param prompt           Current user message
 * @param existingMessages Previous conversation history (empty for new sessions)
 */
export const getProductRecommendations = async (
  prompt: string,
  existingMessages: LLMMessage[] = []
): Promise<RecommendationResult> => {

  const { tool: productTool, enumValues } = await buildProductTool()
  const systemInstruction = buildSystemInstruction(enumValues)

  // Start with existing history + new user message
  let messages: LLMMessage[] = [
    ...existingMessages,
    { role: "user", text: prompt }
  ]

  messages = trimMessagesToTokenLimit(messages)
  let response = await llmService.chat(messages, systemInstruction, [productTool])
  messages.push(response.rawMessage)

  // ── Missed tool-call nudge ──
  // If model replied with text but user clearly has product intent, nudge it to call the tool
  if (!response.toolCall && likelyProductIntent(prompt)) {
    logger.warn("[Engine] Model did not call tool despite product intent — nudging...")
    messages.push({
      role: "user",
      text: "Tolong panggil fungsi getProductRecommendations untuk mencari produk yang sesuai."
    })
    messages = trimMessagesToTokenLimit(messages)
    response = await llmService.chat(messages, systemInstruction, [productTool])
    messages.push(response.rawMessage)
  }

  let products: GetProductResponse[] | null = null
  let iterations = 0

  // ── Function-calling loop ──
  while (response.toolCall) {
    if (++iterations > MAX_TOOL_ITERATIONS) {
      logger.error(`[Engine] Max tool iterations (${MAX_TOOL_ITERATIONS}) exceeded — breaking loop`)
      break
    }

    const { name, arguments: args } = response.toolCall

    if (name !== "getProductRecommendations") {
      throw new Error(`[Engine] Unknown tool called: ${name}`)
    }

    // Guard: truly empty args — ask model to retry with actual filters
    if (isQueryEmpty(args)) {
      logger.warn("[Engine] Model called tool with empty args — requesting retry")

      messages.push({
        role: "tool_result",
        toolResult: {
          name,
          result: {
            status: "EMPTY_ARGS",
            message: "Tidak ada filter yang diberikan. Panggil ulang fungsi dengan minimal satu filter yang spesifik berdasarkan permintaan user."
          }
        }
      })

      messages = trimMessagesToTokenLimit(messages)
      response = await llmService.chat(messages, systemInstruction, [productTool])
      messages.push(response.rawMessage)
      continue
    }

    logger.info(`[Engine] Tool call (iter ${iterations}): ${JSON.stringify(args)}`)

    // Fetch matching products from DB
    products = await productService.getMany(undefined, {
      design: args.design as string[],
      texture: args.texture as string[],
      finishing: args.finishing as string[],
      color: args.color as string[],
      size: args.size as { width: number; height: number }[],
      recommended: args.recommendedFor as string[],
      price: args.price as { min?: number; max?: number } | undefined
    }, undefined, 10)

    logger.info(`[Engine] DB returned ${products.length} products`)

    // ── Widening retry: if 0 results, try with relaxed filters once ──
    if (products.length === 0) {
      const widenedArgs = widenArgs(args)

      if (widenedArgs) {
        logger.info(`[Engine] 0 results — retrying with widened args: ${JSON.stringify(widenedArgs)}`)

        products = await productService.getMany(undefined, {
          design: widenedArgs.design as string[],
          texture: widenedArgs.texture as string[],
          finishing: widenedArgs.finishing as string[],
          color: widenedArgs.color as string[],
          size: widenedArgs.size as { width: number; height: number }[],
          recommended: widenedArgs.recommendedFor as string[],
          price: widenedArgs.price as { min?: number; max?: number } | undefined
        }, undefined, 10)

        logger.info(`[Engine] Widened query returned ${products.length} products`)
      }
    }

    // ── Fallback search: still 0 after widening → try progressively broader queries ──
    if (products.length === 0) {
      logger.info("[Engine] Still 0 after widening — running fallback search...")
      const fallbackProducts = await fallbackSearch(args)

      if (fallbackProducts.length === 0) {
        return {
          message: EMPTY_PRODUCT_MESSAGES[Math.floor(Math.random() * EMPTY_PRODUCT_MESSAGES.length)],
          products: [],
          updatedMessages: messages
        }
      }

      products = fallbackProducts
      messages.push({
        role: "tool_result",
        toolResult: { name, result: { status: "PARTIAL_MATCH", products } }
      })
      messages.push({ role: "user", text: NARRATE_FALLBACK_NUDGE })
    } else {
      // Exact match — feed results and nudge narration
      messages.push({
        role: "tool_result",
        toolResult: { name, result: { status: "SUCCESS", products } }
      })
      messages.push({ role: "user", text: NARRATE_PRODUCTS_NUDGE })
    }

    logger.info("[Engine] Sending product results back to model...")

    messages = trimMessagesToTokenLimit(messages)
    response = await llmService.chat(messages, systemInstruction, [productTool])
    messages.push(response.rawMessage)
  }

  // Refusal fallback — if model refused despite having products, return a neutral handoff
  const finalMessage =
    products && products.length > 0 && isLikelyRefusal(response.text)
      ? `Kami menemukan ${products.length} produk yang mungkin cocok untuk kamu! Silakan cek daftar di bawah ini ya 😊`
      : response.text

  if (products && products.length > 0 && isLikelyRefusal(response.text)) {
    logger.warn("[Engine] Model returned refusal despite having products — using fallback message")
  }

  return {
    message: finalMessage,
    products,
    updatedMessages: messages
  }
}
