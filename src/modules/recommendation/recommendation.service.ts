import { genAI } from "@/core/config/gemini";
import { pineconeIndex } from "@/core/config/pinecone";
import { productRepository } from "@/modules/product/product.repository";
import { promptValidation } from "@/modules/product/product.validation";
import { validate } from "@/core/utils/validate";
import { ObjectId } from "mongodb";
import embeddingService from "./embedding.service";

const getRecommendations = async (prompt: string) => {
  validate(promptValidation, prompt);

  const promptVector = await embeddingService.getEmbeddingFromText(prompt);
  const results = await pineconeIndex.query({
    vector: promptVector,
    topK: 5,
    includeMetadata: true,
  });

  if (results.matches.length === 0) {
    return {
      message: "Maaf, kami tidak dapat menemukan produk yang cocok dengan deskripsi Anda.",
      suggestions: []
    };
  }

  const context = results.matches
    .map(match =>
      `Nama: ${match.metadata?.name}. ` +
      `Deskripsi: ${match.metadata?.description}. ` +
      `Ukuran: ${match.metadata?.size}. ` +
      `Aplikasi: ${match.metadata?.application}. ` +
      `Warna: ${match.metadata?.color}. ` +
      `Desain: ${match.metadata?.design}. ` +
      `Tekstur: ${match.metadata?.texture}. ` +
      `Finishing: ${match.metadata?.finishing}. ` +
      `Brand: ${match.metadata?.brand}. ` +
      `Harga: ${match.metadata?.price}.`
    )
    .join('\n\n');

  const promptText = `Anda adalah seorang asisten ahli di toko keramik. Berdasarkan permintaan pelanggan: "${prompt}" dan data produk yang tersedia:\n\n${context}\n\nBerikan rekomendasi produk yang paling sesuai dalam format naratif yang jelas dan sebutkan alasan mengapa produk tersebut cocok. Jika permintaan tidak jelas, berikan saran umum. Respon ini untuk pelanggan, respon lah seolah-olah anda asisten toko yang sedang membantu pelanggan di toko, gunakan bahasa yang santai tapi sopan`;

  const response = await genAI.models.generateContent({
    model: "gemini-2.5-flash-lite",
    contents: promptText
  });
  const aiResponseText = response.text;

  const productIds = results.matches.map(match => new ObjectId(match.id));
  const suggestions = await productRepository.aggregate([
    { $match: { _id: { $in: productIds } } }
  ]);

  return {
    message: aiResponseText,
    suggestions
  };
};

export default {
  getRecommendations,
};
