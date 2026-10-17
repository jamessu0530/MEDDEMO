import type { BrowseProfile, Product } from "@/api/products"
import type { Work } from "@/lib/background-work"
import { discoverProductsWork } from "@/lib/product-discovery"

export type ProductCatalogQuery = {
  query: string
  category: string | null
  discovery: null | {
    seed: string
    profile: BrowseProfile
    visibleSkus: string[]
    previousSkus: string[]
    now: number
  }
}
export type ProductCatalogResult = {
  indices: number[]
  categories: { name: string; count: number }[]
}
type CatalogIndex = {
  text: string[]
  indices: Map<Product, number>
  categories: ProductCatalogResult["categories"]
}
const indexes = new WeakMap<Product[], CatalogIndex>()

export function* productCatalogWork(
  products: Product[],
  query: ProductCatalogQuery
): Work<ProductCatalogResult> {
  let index = indexes.get(products)
  let work = 0
  if (!index) {
    const text: string[] = [],
      indices = new Map<Product, number>(),
      categories = new Map<string, number>()
    for (let at = 0; at < products.length; at++) {
      const product = products[at]
      text.push(
        [
          product.name,
          product.sku,
          product.category,
          product.spec,
          ...product.aliases,
        ]
          .join(" ")
          .toLowerCase()
      )
      indices.set(product, at)
      categories.set(
        product.category,
        (categories.get(product.category) ?? 0) + 1
      )
      if (++work % 128 === 0) yield
    }
    index = {
      text,
      indices,
      categories: [...categories]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => a.name.localeCompare(b.name, "zh-TW")),
    }
    indexes.set(products, index)
  }
  const terms = query.query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const found: Product[] = []
  for (let at = 0; at < products.length; at++) {
    const product = products[at]
    if (
      (!query.category || product.category === query.category) &&
      terms.every((term) => index.text[at].includes(term))
    )
      found.push(product)
    if (++work % 128 === 0) yield
  }
  const discovery = query.discovery
  const ordered = discovery
    ? yield* discoverProductsWork(
        found,
        discovery.profile,
        discovery.seed,
        discovery.visibleSkus,
        discovery.now
      )
    : found
  const indices: number[] = []
  let unchanged = !!discovery && ordered.length > 1
  for (let at = 0; at < ordered.length; at++) {
    const product = ordered[at]
    indices.push(index.indices.get(product)!)
    if (product.sku !== discovery?.previousSkus[at]) unchanged = false
    if (++work % 128 === 0) yield
  }
  if (unchanged) indices.push(indices.shift()!)
  return { indices, categories: index.categories }
}
