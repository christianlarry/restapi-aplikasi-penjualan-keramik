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
import { GetProductResponse } from "@/modules/product/product.types"
import { logger } from "@/core/config/logger"

// ─── Exported result type ─────────────────────────────────────────────────────

export interface RecommendationResult {
  message: string | undefined
  products: GetProductResponse[] | null
  /** Full conversation history after this turn — persist in session */
  updatedMessages: LLMMessage[]
}

// ─── System instruction ───────────────────────────────────────────────────────

const SYSTEM_INSTRUCTION = `Kamu adalah asisten virtual dari toko "CV Aneka Keramik". Gaya bicaramu santai, fun, dan sopan. Tugasmu adalah memberikan rekomendasi produk keramik.
- JIKA user menyebutkan ciri-ciri produk (seperti warna, ukuran, desain, tekstur, harga, atau area penggunaan), SELALU panggil fungsi 'getProductRecommendations' untuk mencari data.
- JIKA user memberikan prompt yang terlalu umum atau tidak jelas (misal: "cariin keramik dong"), kasih respon (contoh: "Maaf ya! Sepertinya kita belum bisa kasih rekomendasi nih. Coba deh jelaskan kebutuhanmu dengan cara lain"), minta user untuk menjelaskan dengan detail yang lebih spesifik tentang keramik yang dicari.
- JIKA user tanya "Ada keramik apa saja?" jawab, silahkan cek langsung di katalog kami. kamu hanya bisa berikan rekomendasi sesuai kebutuhan saja.
- JIKA kamu menerima hasil fungsi dengan status 'QUERY_TOO_BROAD', artinya permintaan user terlalu umum. Katakan bahwa permintaan terlalu umum. Minta user jelaskan dengan detail spesifik.
- Setelah menerima daftar produk dari sistem, jelaskan produk tersebut kepada pelanggan dengan gaya bahasamu. Berikan alasan mengapa produk itu cocok. Cari produk yang paling relevan saja dan berikan penjelasan, produk yang tidak terlalu relevan jadikan list honorable mention saja.
- JANGAN PERNAH menanyakan pertanyaan balik seperti "apakah mau mencari yang lain?". Cukup berikan jawaban final berdasarkan data yang kamu terima.
- "Desain modern dan material premium" contoh prompt seperti ini tidak akan dikenali argsnya, tapi kamu tetap bisa mengatur argsnya. "Desain modern dan material premium" bisa jadi yang teksturnya slightly textured, bisa jadi kombinasi warna putih dan finishing matte itu modern dan premium. setiap deskripsi prompt pasti ada kombinasi contoh "Saya butuh produk untuk kamar anak". cari kombinasinya dan masukkan ke args.
- Berikan kombinasi ukuran jika permintaan tidak spesifik contoh ("Ukurannya besar")`

const EMPTY_PRODUCT_MESSAGES = [
  "Waduh, maaf banget nih dari CV Aneka Keramik! Kayaknya produk yang kamu cari lagi sembunyi atau belum ada. Coba deh pakai kata kunci lain yang lebih umum, siapa tahu ketemu jodohnya! 😉",
  "Yah, sayang sekali! Produk dengan spek itu lagi kosong, nih. Tapi jangan khawatir, kami punya banyak koleksi lain yang nggak kalah keren. Coba cari dengan kata kunci berbeda, yuk!",
  "Hmm, sepertinya produk impianmu lagi nggak ada di stok kami. Maaf ya! Coba deh jelaskan kebutuhanmu dengan cara lain, mungkin aku bisa bantu carikan alternatif terbaik dari CV Aneka Keramik!",
  "Aduh, maaf ya, produk yang kamu maksud belum ketemu nih. Mungkin lagi di jalan atau speknya terlalu unik! Coba deh cari yang mirip-mirip, koleksi kami banyak banget lho!",
  "Maaf sekali dari CV Aneka Keramik, produknya belum tersedia saat ini. Tapi tenang, setiap hari ada aja yang baru di sini. Coba lagi dengan kata kunci lain atau cek lagi besok ya!"
]

// ─── Tool builder ─────────────────────────────────────────────────────────────

/** Build the product recommendation tool with live enum values from DB */
const buildProductTool = async (): Promise<LLMTool> => {
  const [design, texture, finishing, color, recommendedFor] = await Promise.all([
    productService.getDistinctValues("specification.design"),
    productService.getDistinctValues("specification.texture"),
    productService.getDistinctValues("specification.finishing"),
    productService.getDistinctValues("specification.color"),
    productService.getDistinctValues("recommended")
  ])

  return {
    name: "getProductRecommendations",
    description: "Mendapatkan daftar rekomendasi produk keramik berdasarkan kriteria filter dari database produk.",
    parameters: {
      type: "object",
      properties: {
        design: {
          type: "array",
          items: { type: "string", enum: design },
          description: "Filter berdasarkan desain keramik, contoh: 'Modern', 'Minimalis'."
        },
        texture: {
          type: "array",
          items: { type: "string", enum: texture },
          description: "Filter berdasarkan tekstur permukaan keramik, contoh: 'Glossy', 'Matte'."
        },
        finishing: {
          type: "array",
          items: { type: "string", enum: finishing },
          description: "Filter berdasarkan finishing keramik, contoh: 'Polished', 'Unpolished'."
        },
        color: {
          type: "array",
          items: { type: "string", enum: color },
          description: "Filter berdasarkan warna keramik, contoh: 'Putih', 'Abu-abu'."
        },
        size: {
          type: "array",
          items: {
            type: "object",
            properties: {
              width: { type: "number", description: "Lebar keramik dalam cm." },
              height: { type: "number", description: "Tinggi keramik dalam cm." }
            }
          },
          description: "Filter berdasarkan ukuran keramik dalam sentimeter."
        },
        recommendedFor: {
          type: "array",
          items: { type: "string", enum: recommendedFor },
          description: "Filter berdasarkan area aplikasi, contoh: 'Kamar Mandi', 'Dapur'."
        },
        price: {
          type: "object",
          properties: {
            min: { type: "number", description: "Harga minimal. jika tidak ditentukan maka default = 0" },
            max: { type: "number", description: "Harga maksimal. jika tidak ditentukan maka default = 999999999999" }
          },
          description: "Filter berdasarkan harga."
        }
      }
    }
  }
}

// ─── Keys that indicate a too-broad query ─────────────────────────────────────

const BROAD_FILTER_KEYS = ["design", "texture", "finishing", "color", "recommendedFor"]

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

  const productTool = await buildProductTool()

  // Start with existing history + new user message
  const messages: LLMMessage[] = [
    ...existingMessages,
    { role: "user", text: prompt }
  ]

  let response = await llmService.chat(messages, SYSTEM_INSTRUCTION, [productTool])
  messages.push(response.rawMessage)

  let products: GetProductResponse[] | null = null

  // Function-calling loop — same logic regardless of LLM provider
  while (response.toolCall) {
    const { name, arguments: args } = response.toolCall

    if (name !== "getProductRecommendations") {
      throw new Error(`Unknown tool: ${name}`)
    }

    // Guard: model returned empty args
    if (!args || Object.keys(args).length === 0) {
      logger.error("[Engine] Model called tool with empty args")
      return {
        message: "Maaf ya! Sepertinya kita belum bisa kasih rekomendasi nih. Coba deh jelaskan kebutuhanmu dengan cara lain, mungkin aku bisa bantu carikan alternatif terbaik dari CV Aneka Keramik!",
        products: [],
        updatedMessages: messages
      }
    }

    // Guard: query too broad (only a single top-level filter key)
    const argKeys = Object.keys(args)
    if (argKeys.length === 1 && BROAD_FILTER_KEYS.includes(argKeys[0])) {
      logger.warn("[Engine] Query too broad — sending QUERY_TOO_BROAD status back")

      messages.push({
        role: "tool_result",
        toolResult: { name, result: { status: "QUERY_TOO_BROAD", products: [] } }
      })

      response = await llmService.chat(messages, SYSTEM_INSTRUCTION, [productTool])
      messages.push(response.rawMessage)
      continue
    }

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

    logger.info(`[Engine] Retrieved ${products.length} products from DB for tool call`)

    if (products.length === 0) {
      return {
        message: EMPTY_PRODUCT_MESSAGES[Math.floor(Math.random() * EMPTY_PRODUCT_MESSAGES.length)],
        products,
        updatedMessages: messages
      }
    }

    // Feed product results back to the model
    messages.push({
      role: "tool_result",
      toolResult: { name, result: { status: "SUCCESS", products } }
    })

    logger.info("[Engine] Sending product results back to model...")

    response = await llmService.chat(messages, SYSTEM_INSTRUCTION, [productTool])
    messages.push(response.rawMessage)
  }

  return {
    message: response.text,
    products,
    updatedMessages: messages
  }
}
