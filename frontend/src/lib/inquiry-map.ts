import type { CustomerInquiry, InquiryLocation } from "@/api/customer-inquiries"

export type LocatedInquiry = CustomerInquiry & { location: InquiryLocation }
export type InquiryPlace = {
  id: string
  location: InquiryLocation
  inquiries: LocatedInquiry[]
}

/** Nearby question pins share a marker; order never creates a route between them. */
export function groupInquiryLocations(
  items: CustomerInquiry[]
): InquiryPlace[] {
  const places = new Map<string, InquiryPlace>()
  for (const item of items) {
    const fix = item.location
    if (
      !fix ||
      !Number.isFinite(fix.lat) ||
      Math.abs(fix.lat) > 90 ||
      !Number.isFinite(fix.lng) ||
      Math.abs(fix.lng) > 180
    )
      continue
    const key = `${fix.lat.toFixed(4)},${fix.lng.toFixed(4)}`
    let place = places.get(key)
    if (!place) {
      place = { id: key, location: fix, inquiries: [] }
      places.set(key, place)
    }
    place.inquiries.push({ ...item, location: fix })
  }
  return [...places.values()]
}

export function inquiryPlaceLabel(location: InquiryLocation) {
  return (
    location.place_name ||
    `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`
  )
}
