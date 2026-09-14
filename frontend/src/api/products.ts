import { request } from "@/api/client"

export type Product = {
  sku: string
  name: string
  category: string
  unit: string
  aliases: string[]
}

export function listProducts(signal?: AbortSignal) {
  return request<Product[]>("/api/products", { signal })
}
