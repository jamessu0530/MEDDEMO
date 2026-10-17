export type StoredStorefrontPhoto = {
  image_url: string
  source_url: string
  credit?: string | null
  license_name?: string | null
  license_url?: string | null
}

export type StorefrontCustomer = {
  id?: string
  name: string
  city: string
  area: string
  address?: string | null
  storefront_photo?: StoredStorefrontPhoto | null
  google_place_id?: string | null
}
export type StorefrontCandidate = {
  displayName?: string | null
  formattedAddress?: string | null
}

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .replaceAll("台", "臺")
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .toLowerCase()
}

function storeName(value: string) {
  return normalize(value).replaceAll("連鎖", "").replaceAll("門市", "店")
}

export function storefrontQuery(customer: StorefrontCustomer) {
  return [
    customer.address ||
      [customer.city, customer.area].filter(Boolean).join(" "),
    customer.name.replace(/\s*·\s*/g, " "),
  ]
    .filter(Boolean)
    .join(" ")
}

export function storefrontSearchUrl(customer: StorefrontCustomer) {
  const params = new URLSearchParams({
    api: "1",
    query: storefrontQuery(customer),
  })
  if (customer.google_place_id)
    params.set("query_place_id", customer.google_place_id)
  return `https://www.google.com/maps/search/?${params}`
}

/** 同時核對完整店名（含分店）與行政區。多個結果都符合時，留給使用者在 Google 確認。 */
export function findStorefront<T extends StorefrontCandidate>(
  customer: StorefrontCustomer,
  candidates: T[]
): T | null {
  // 獨立店的 CRM 名稱常附「· 北投」作辨識，Google 店名通常沒有這段地區。
  const parts = customer.name.split(/\s*·\s*/)
  const nameWithoutArea =
    parts.length === 2 && normalize(parts[1]) === normalize(customer.area)
      ? parts[0]
      : customer.name
  const expected = storeName(nameWithoutArea)
  const city = normalize(customer.city)
  const area = normalize(customer.area)
  if (!expected || !city || !area) return null
  const districts = /[區鄉鎮市]$/.test(area)
    ? [area]
    : ["區", "鄉", "鎮", "市"].map((suffix) => area + suffix)
  const matches = candidates.filter((candidate) => {
    const name = storeName(candidate.displayName ?? "")
    const address = normalize(candidate.formattedAddress ?? "")
    const street = normalize(customer.address ?? "")
      .replace(/^\d{3,6}/, "")
      .replace(/^臺灣/, "")
      .match(/(?:市|縣).+?號/)?.[0]
    return (
      name.replace(/店$/, "") === expected.replace(/店$/, "") &&
      districts.some((district) => address.includes(city + district)) &&
      (!street || address.includes(street))
    )
  })
  return matches.length === 1 ? matches[0] : null
}

/** 把街景鏡頭轉向 Google 店家位置，不使用示範資料的座標。 */
export function storefrontHeading(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
) {
  const radians = Math.PI / 180
  const delta = (to.lng - from.lng) * radians
  const y = Math.sin(delta) * Math.cos(to.lat * radians)
  const x =
    Math.cos(from.lat * radians) * Math.sin(to.lat * radians) -
    Math.sin(from.lat * radians) * Math.cos(to.lat * radians) * Math.cos(delta)
  return (Math.atan2(y, x) / radians + 360) % 360
}
