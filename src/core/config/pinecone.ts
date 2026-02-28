import { Pinecone } from "@pinecone-database/pinecone"
import { env } from "@/core/config/env"

export const pinecone = new Pinecone({
  apiKey: env.PINECONE_API_KEY,
})

export const pineconeIndex = pinecone.index(env.PINECONE_INDEX)
