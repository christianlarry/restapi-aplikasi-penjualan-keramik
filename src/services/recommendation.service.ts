import { genAI } from "@/config/gemini";
import { pineconeIndex } from "@/config/pinecone";
import { productModel } from "@/models/product.model";
import { promptValidation } from "@/validations/product.validation";
import { validate } from "@/validations/validation";
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
  const suggestions = await productModel().find({
    _id: { $in: productIds }
  }).toArray();

  return {
    message: aiResponseText,
    suggestions
  };
};

export default {
  getRecommendations,
};