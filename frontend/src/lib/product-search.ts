import type { Product } from "@/api/products"

// 手機上的原生選單一次列太多不好滑；找到更多就請業務多打幾個字
export const PRODUCT_SEARCH_LIMIT = 50

/** 商品頁查完整型錄，包含非常用品項；多個搜尋詞都必須符合，不套用確認頁的 50 項上限。 */
export function catalogProducts(
  products: Product[],
  query: string,
  category: string | null
): Product[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return products.filter((product) => {
    if (category && product.category !== category) return false
    const text = [
      product.name,
      product.sku,
      product.category,
      product.spec,
      ...product.aliases,
    ]
      .join(" ")
      .toLowerCase()
    return terms.every((term) => text.includes(term))
  })
}

/**
 * 挑品項的選單要列哪些：沒打字只列常用品項，打字就從整份真實型錄找品名、料號或口語叫法（英文不分大小寫）。
 * 已經選的品項一定列在最後，選單才不會跳掉
 */
export function productOptions(products: Product[], query: string, chosenSku: string | null, matchedSkus?: string[] | null): Product[] {
  const q = query.trim().toLowerCase()
  const bySku = new Map(products.map((product) => [product.sku, product]))
  const matches = q
    ? (matchedSkus != null
        ? matchedSkus.flatMap((sku) => bySku.get(sku) ?? [])
        : catalogProducts(products, query, null))
      .slice(0, PRODUCT_SEARCH_LIMIT)
    : products.filter((p) => p.common)
  const chosen = products.find((p) => p.sku === chosenSku)
  return chosen && !matches.includes(chosen) ? [...matches, chosen] : matches
}
