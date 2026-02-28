import { genAI } from "@/core/config/gemini";

const getEmbeddingFromText = async (text: string) => {
  const response = await genAI.models.embedContent({
    model: 'gemini-embedding-001',
    contents: text,
    config: {
      outputDimensionality: 1024
    }
  });

  return response.embeddings?.[0].values ?? []
}

export default {
  getEmbeddingFromText
}
