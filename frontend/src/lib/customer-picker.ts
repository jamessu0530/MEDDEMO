import type { Customer } from "@/api/customers"

export const CUSTOMER_PAGE_SIZE = 100

/** Default browsing starts with available photos; searches retain API relevance. */
export function orderPickerCustomers(customers: Customer[], query: string) {
  if (query.trim()) return customers
  return customers.toSorted(
    (a, b) => Number(!!b.storefront_photo) - Number(!!a.storefront_photo)
  )
}
