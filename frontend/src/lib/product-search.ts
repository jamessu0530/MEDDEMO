import type { Product } from "@/api/products"

// 手機上的原生選單一次列太多不好滑；找到更多就請業務多打幾個字
export const PRODUCT_SEARCH_LIMIT = 50

/**
 * 挑品項的選單要列哪些：沒打字只列常用品項，打字就從整份真實型錄找品名、料號或口語叫法（英文不分大小寫）。
 * 已經選的品項一定列在最後，選單才不會跳掉
 */
export function productOptions(products: Product[], query: string, chosenSku: string | null): Product[] {
  const q = query.trim().toLowerCase()
  const matches = q
    ? products
        .filter((p) => [p.name, p.sku, ...p.aliases].some((text) => text.toLowerCase().includes(q)))
        .slice(0, PRODUCT_SEARCH_LIMIT)
    : products.filter((p) => p.common)
  const chosen = products.find((p) => p.sku === chosenSku)
  return chosen && !matches.includes(chosen) ? [...matches, chosen] : matches
}
