import { genAI, genAIModel } from "@/core/config/gemini";
import { ContentListUnion, FunctionDeclaration, GenerateContentConfig, Type } from "@google/genai";
import productService from "@/modules/product/product.service";
import { logger } from "@/core/config/logger";
import { GetProductResponse } from "@/modules/product/product.types";

interface EnumValues {
  design: string[],
  texture: string[],
  finishing: string[],
  color: string[],
  recommendedFor: string[]
}

const productRecommendationsTool = (enumValues: EnumValues): FunctionDeclaration => {
  return {
    name: "getProductRecommendations",
    description: "Mendapatkan daftar rekomendasi produk keramik berdasarkan kriteria filter dari database produk.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        design: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING,
            enum: enumValues.design
          },
          description: "Filter berdasarkan desain keramik, contoh: 'Modern', 'Minimalis'."
        },
        texture: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING,
            enum: enumValues.texture
          },
          description: "Filter berdasarkan tekstur permukaan keramik, contoh: 'Glossy', 'Matte'."
        },
        finishing: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING,
            enum: enumValues.finishing
          },
          description: "Filter berdasarkan finishing keramik, contoh: 'Polished', 'Unpolished'."
        },
        color: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING,
            enum: enumValues.color
          },
          description: "Filter berdasarkan warna keramik, contoh: 'Putih', 'Abu-abu'."
        },
        size: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              width: { type: Type.NUMBER, description: "Lebar keramik dalam cm." },
              height: { type: Type.NUMBER, description: "Tinggi keramik dalam cm." }
            }
          },
          description: "Filter berdasarkan ukuran keramik dalam sentimeter."
        },
        recommendedFor: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING,
            enum: enumValues.recommendedFor
          },
          description: "Filter berdasarkan area aplikasi, contoh: 'Kamar Mandi', 'Dapur'."
        },
        price: {
          type: Type.OBJECT,
          properties: {
            min: { type: Type.NUMBER, description: "Harga minimal. jika tidak ditentukan maka default = 0" },
            max: { type: Type.NUMBER, description: "Harga maksimal. jika tidak ditentukan maka default = 999999999999" }
          },
          description: "Filter berdasarkan harga."
        }
      }
    }
  } as FunctionDeclaration
}

const SYSTEM_INSTRUCTION = `Kamu adalah asisten virtual dari toko "CV Aneka Keramik". Gaya bicaramu santai, fun, dan sopan. Tugasmu adalah memberikan rekomendasi produk keramik.
- JIKA user menyebutkan ciri-ciri produk (seperti warna, ukuran, desain, tekstur, harga, atau area penggunaan), SELALU panggil fungsi 'getProductRecommendations' untuk mencari data.
- JIKA user memberikan prompt yang terlalu umum atau tidak jelas (misal: "cariin keramik dong"), kasih respon (contoh: "Maaf ya! Sepertinya kita belum bisa kasih rekomendasi nih. Coba deh jelaskan kebutuhanmu dengan cara lain"), minta user untuk menjelaskan dengan detail yang lebih spesifik tentang keramik yang dicari.
- JIKA user tanya "Ada keramik apa saja?" jawab, silahkan cek langsung di katalog kami. kamu hanya bisa berikan rekomendasi sesuai kebutuhan saja.
- JIKA kamu menerima hasil fungsi dengan status 'QUERY_TOO_BROAD', artinya permintaan user terlalu umum. Katakan bahwa permintaan terlalu umum. Minta user jelaskan dengan detail spesifik.
- Setelah menerima daftar produk dari sistem, jelaskan produk tersebut kepada pelanggan dengan gaya bahasamu. Berikan alasan mengapa produk itu cocok. Cari produk yang paling relevan saja dan berikan penjelasan, produk yang tidak terlalu relevan jadikan list honorable mention saja.
- JANGAN PERNAH menanyakan pertanyaan balik seperti "apakah mau mencari yang lain?". Cukup berikan jawaban final berdasarkan data yang kamu terima.
- "Desain modern dan material premium" contoh prompt seperti ini tidak akan dikenali argsnya, tapi kamu tetap bisa mengatur argsnya. "Desain modern dan material premium" bisa jadi yang teksturnya slightly textured, bisa jadi kombinasi warna putih dan finishing matte itu modern dan premium. setiap deskripsi prompt pasti ada kombinasi contoh "Saya butuh produk untuk kamar anak". cari kombinasinya dan masukkan ke args.
- Berikan kombinasi ukuran jika permintaan tidak spesifik contoh ("Ukurannya besar")`;

const EMPTY_PRODUCT_MESSAGES = [
  "Waduh, maaf banget nih dari CV Aneka Keramik! Kayaknya produk yang kamu cari lagi sembunyi atau belum ada. Coba deh pakai kata kunci lain yang lebih umum, siapa tahu ketemu jodohnya! 😉",
  "Yah, sayang sekali! Produk dengan spek itu lagi kosong, nih. Tapi jangan khawatir, kami punya banyak koleksi lain yang nggak kalah keren. Coba cari dengan kata kunci berbeda, yuk!",
  "Hmm, sepertinya produk impianmu lagi nggak ada di stok kami. Maaf ya! Coba deh jelaskan kebutuhanmu dengan cara lain, mungkin aku bisa bantu carikan alternatif terbaik dari CV Aneka Keramik!",
  "Aduh, maaf ya, produk yang kamu maksud belum ketemu nih. Mungkin lagi di jalan atau speknya terlalu unik! Coba deh cari yang mirip-mirip, koleksi kami banyak banget lho!",
  "Maaf sekali dari CV Aneka Keramik, produknya belum tersedia saat ini. Tapi tenang, setiap hari ada aja yang baru di sini. Coba lagi dengan kata kunci lain atau cek lagi besok ya!"
];

const getProductRecommendations = async (prompt: string) => {

  const designEnum = await productService.getDistinctValues("specification.design")
  const textureEnum = await productService.getDistinctValues("specification.texture")
  const finishingEnum = await productService.getDistinctValues("specification.finishing")
  const colorEnum = await productService.getDistinctValues("specification.color")
  const recommendedForEnum = await productService.getDistinctValues("recommended")

  const contents: ContentListUnion = [
    {
      role: "user",
      parts: [{ text: prompt }]
    }
  ]

  const config: GenerateContentConfig = {
    tools: [{
      functionDeclarations: [productRecommendationsTool({
        color: colorEnum,
        design: designEnum,
        finishing: finishingEnum,
        texture: textureEnum,
        recommendedFor: recommendedForEnum
      })]
    }],
    systemInstruction: {
      role: "system",
      parts: [{ text: SYSTEM_INSTRUCTION }]
    }
  }

  let response = await genAI.models.generateContent({
    model: genAIModel,
    contents,
    config,
  })

  let products: GetProductResponse[] | null = null

  while (response.functionCalls && response.functionCalls.length > 0) {

    const call = response.functionCalls[0]
    const functionName = call.name
    const functionArgs = call.args

    if (functionName === "getProductRecommendations") {
      logger.info(`Model wants to call getProductRecommendations with args:\n${JSON.stringify(functionArgs)}`)

      if (
        // eslint-disable-next-line no-constant-binary-expression, valid-typeof
        typeof functionArgs == undefined ||
        !functionArgs ||
        Object.keys(functionArgs).length === 0
      ) {
        logger.error("Model failed to call getProductRecommendations")

        return {
          message: "Maaf ya! Sepertinya kita belum bisa kasih rekomendasi nih. Coba deh jelaskan kebutuhanmu dengan cara lain, mungkin aku bisa bantu carikan alternatif terbaik dari CV Aneka Keramik!",
          products: []
        }
      }

      const argKeys = Object.keys(functionArgs);
      const broadFilterKeys = ['design', 'texture', 'finishing', 'color', 'recommendedFor'];
      let functionResponsePart;

      if (argKeys.length === 1 && broadFilterKeys.includes(argKeys[0])) {
        logger.warn("Query is too broad. Asking user for more details.");

        functionResponsePart = {
          name: functionName,
          response: {
            status: 'QUERY_TOO_BROAD',
            products: []
          }
        };

      } else {
        products = await productService.getMany(undefined, {
          design: functionArgs?.design as string[],
          texture: functionArgs?.texture as string[],
          finishing: functionArgs?.finishing as string[],
          color: functionArgs?.color as string[],
          size: functionArgs?.size as { width: number, height: number }[],
          recommended: functionArgs?.recommendedFor as string[],
          price: functionArgs?.price as { min: number | undefined, max: number | undefined } | undefined
        }, undefined, 10)

        if (products.length === 0) {
          return {
            message: EMPTY_PRODUCT_MESSAGES[Math.floor(Math.random() * EMPTY_PRODUCT_MESSAGES.length)],
            products
          }
        }

        functionResponsePart = {
          name: functionName,
          response: {
            status: 'SUCCESS',
            products
          }
        };
      }

      contents.push(response.candidates![0].content!)
      contents.push({
        role: "user",
        parts: [
          { functionResponse: functionResponsePart }
        ]
      })

      logger.info("Sending function result back to model...");

      response = await genAI.models.generateContent({
        model: genAIModel,
        contents,
        config
      })

    } else {
      throw new Error(`Function not found ${functionName}`)
    }
  }

  return {
    message: response.text,
    products
  }
}

export default {
  getProductRecommendations
}
