import type { BrowseProfile, Product } from "@/api/products"
import { finishWork, sortWork, type Work } from "@/lib/background-work"

export const PRODUCT_BATCH = 24
export const BROWSE_IDLE_MS = 30_000

export function effectiveBrowseTime({
  elapsed,
  now,
  lastActivity,
  visible,
  foreground,
  demo,
}: {
  elapsed: number
  now: number
  lastActivity: number
  visible: boolean
  foreground: boolean
  demo: boolean
}) {
  if (!visible || !foreground || demo || now - lastActivity > BROWSE_IDLE_MS)
    return 0
  return Math.min(1200, Math.max(0, elapsed))
}

/** 有效閱讀與主動展開是正向訊號；左右滑不帶正負標籤。近期偏好逐漸衰減，長時間停著不會無限加分。 */
function* productAffinitiesWork(
  products: Product[],
  profile: BrowseProfile,
  now: number
): Work<Map<string, number>> {
  const own = new Map<string, number>()
  const categories = new Map<string, { sum: number; count: number }>()
  let work = 0
  for (const product of products) {
    if (++work % 128 === 0) yield
    const signal = profile[product.sku]
    if (!signal) continue
    const age = Math.max(0, now - (Date.parse(signal.last_seen) || now))
    const strength =
      (Math.log1p(Math.min(signal.active_ms, 60_000) / 1000) +
        Math.min(signal.opens, 4) * 2.5) *
      2 ** (-age / (30 * 86400_000))
    own.set(product.sku, strength)
    const category = categories.get(product.category) ?? { sum: 0, count: 0 }
    category.sum += strength
    category.count++
    categories.set(product.category, category)
  }
  const result = new Map<string, number>()
  for (const product of products) {
    const category = categories.get(product.category)
    result.set(
      product.sku,
      Math.min(
        8,
        (own.get(product.sku) ?? 0) * 0.25 +
          (category ? category.sum / category.count : 0) * 0.6
      )
    )
    if (++work % 128 === 0) yield
  }
  return result
}

export function productAffinities(
  products: Product[],
  profile: BrowseProfile,
  now = Date.now()
) {
  return finishWork(productAffinitiesWork(products, profile, now))
}

function randomFor(seed: string, sku: string) {
  let hash = 2166136261
  for (const char of `${seed}:${sku}`)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return ((hash >>> 0) + 1) / 4294967297
}

/** 有偏好的隨機抽樣：保留所有搜尋結果，少看過的優先，也留空間遇見新類別。 */
export function* discoverProductsWork(
  products: Product[],
  profile: BrowseProfile,
  seed: string,
  visibleSkus: string[] = [],
  now = Date.now()
): Work<Product[]> {
  const affinity = yield* productAffinitiesWork(products, profile, now)
  const visible = new Set(visibleSkus)
  const weighted = []
  let work = 0
  for (const product of products) {
    weighted.push({
      product,
      key:
        (-Math.log(randomFor(seed, product.sku)) *
          (visible.has(product.sku) ? 3 : 1)) /
        (1 + (affinity.get(product.sku) ?? 0)),
    })
    if (++work % 128 === 0) yield
  }
  const sorted = yield* sortWork(
    weighted,
    (a, b) => a.key - b.key || a.product.sku.localeCompare(b.product.sku)
  )
  const result: Product[] = []
  for (const { product } of sorted) {
    result.push(product)
    if (++work % 128 === 0) yield
  }
  return result
}

export function discoverProducts(
  products: Product[],
  profile: BrowseProfile,
  seed: string,
  visibleSkus: string[] = [],
  now = Date.now()
) {
  return finishWork(
    discoverProductsWork(products, profile, seed, visibleSkus, now)
  )
}

export function horizontalSwap(
  dx: number,
  dy: number
): "left" | "right" | null {
  return Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.6
    ? dx < 0
      ? "left"
      : "right"
    : null
}
