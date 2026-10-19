import type { Customer, PurchasedProduct } from "@/api/customers"

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll("臺", "台")
    .replace(/\s+/g, "")
}

export function matchesPurchasedProduct(
  product: PurchasedProduct,
  query: string
) {
  const keyword = normalize(query)
  return (
    !keyword ||
    [
      product.name,
      product.sku,
      product.category,
      product.spec,
      ...product.aliases,
    ].some((value) => normalize(value).includes(keyword))
  )
}

export function matchesCustomerKeyword(customer: Customer, query: string) {
  const keyword = normalize(query)
  return (
    !keyword ||
    [
      customer.id,
      customer.name,
      customer.city,
      customer.area,
      customer.address,
      customer.phone,
    ].some((value) => value && normalize(value).includes(keyword)) ||
    !!customer.purchased_products?.some((product) =>
      matchesPurchasedProduct(product, query)
    )
  )
}

export function rankPurchasedProducts(products: PurchasedProduct[]) {
  return products.toSorted(
    (a, b) =>
      b.total_qty - a.total_qty ||
      b.order_count - a.order_count ||
      b.last_order_date.localeCompare(a.last_order_date) ||
      a.sku.localeCompare(b.sku)
  )
}

/** 平常顯示叫貨量最多的三項；搜尋時先顯示命中的品項。 */
export function purchaseKeywordPreview(
  products: PurchasedProduct[],
  query: string,
  limit = 3
) {
  const ranked = rankPurchasedProducts(products)
  const ordered = query.trim()
    ? [
        ...ranked.filter((p) => matchesPurchasedProduct(p, query)),
        ...ranked.filter((p) => !matchesPurchasedProduct(p, query)),
      ]
    : ranked
  return ordered.slice(0, limit)
}
