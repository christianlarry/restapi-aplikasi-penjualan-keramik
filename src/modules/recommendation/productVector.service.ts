import { pineconeIndex } from "@/core/config/pinecone";
import { Product } from "@/modules/product/product.types";
import embeddingService from "./embedding.service";

const generateProductEmbeddingsText = (product: Product): string => {
  return `${product.name}. ${product.description ?? ""}. Desain: ${product.specification.design}. Tekstur: ${product.specification.texture}. Warna: ${product.specification.color.join(", ")}. Finishing: ${product.specification.finishing}. Aplikasi: ${product.specification.application.join(", ")}. Merek: ${product.brand}. Harga: ${product.price}. Ukuran: ${product.specification.size.width}x${product.specification.size.height}. Cocok Untuk: ${product.recommended?.join(", ") ?? ""}`;
};

const generateProductIndexData = (product: Product, embeddings: number[]) => ({
  id: product._id?.toString() ?? "",
  values: embeddings,
  metadata: {
    name: product.name,
    description: product.description ?? "",
    size: `${product.specification.size.width}x${product.specification.size.height}`,
    application: product.specification.application.join(", "),
    color: product.specification.color.join(", "),
    design: product.specification.design,
    texture: product.specification.texture,
    finishing: product.specification.finishing,
    brand: product.brand,
    price: product.price,
  }
});

const upsert = async (product: Product) => {
  const text = generateProductEmbeddingsText(product);
  const embeddings = await embeddingService.getEmbeddingFromText(text);
  await pineconeIndex.upsert([generateProductIndexData(product, embeddings)]);
};

const update = async (product: Product) => {
  const text = generateProductEmbeddingsText(product);
  const embeddings = await embeddingService.getEmbeddingFromText(text);
  await pineconeIndex.update(generateProductIndexData(product, embeddings));
};

const remove = async (productId: string) => {
  await pineconeIndex.deleteOne(productId);
};

export default {
  upsert,
  update,
  remove,
};
