import { request } from "@/api/client"

export type Product = {
  sku: string
  name: string
  category: string
  unit: string
  aliases: string[]
  // 常用品項：確認頁的預設選單只列這些，其他要搜尋才找得到
  common: boolean
}

export function listProducts(signal?: AbortSignal) {
  return request<Product[]>("/api/products", { signal })
}
