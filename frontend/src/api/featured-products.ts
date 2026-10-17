import { jsonBody, request } from "@/api/client"

export type FeaturedSettings = {
  manager_id: string
  festival_id: string | null
  managers: { id: string; name: string }[]
  festivals: { id: string; name: string; date: string; categories: string[] }[]
  skus: string[]
  revision: number
  updated_at: string | null
  updated_by: string | null
  max_products: number
}

export type FeaturedProducts = {
  manager_id: string
  manager_name: string
  festival_id: string
  items: {
    sku: string
    name: string
    category: string
    spec: string
    unit: string
    supply_price: number | null
    unit_cost: number | null
    unit_margin: number | null
    margin_rate: number | null
    price_source: string
    deal: string | null
  }[]
}

export function getFeaturedSettings(
  managerId?: string,
  festivalId?: string,
  signal?: AbortSignal
) {
  const params = new URLSearchParams()
  if (managerId) params.set("manager_id", managerId)
  if (festivalId) params.set("festival_id", festivalId)
  return request<FeaturedSettings>(`/api/manager/featured-products?${params}`, {
    signal,
  })
}

export function saveFeaturedProducts(
  settings: FeaturedSettings,
  skus: string[]
) {
  return request<FeaturedSettings>(
    "/api/manager/featured-products",
    jsonBody("PUT", {
      manager_id: settings.manager_id,
      festival_id: settings.festival_id,
      revision: settings.revision,
      skus,
    })
  )
}
