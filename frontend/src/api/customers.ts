import { request } from "@/api/client"

export type Customer = {
  id: string
  name: string
  type: "chain" | "independent" | "clinic"
  region: string
  grade: string
  owner_name: string
  last_visit_date: string | null
}

export const CUSTOMER_TYPE_LABEL: Record<Customer["type"], string> = {
  chain: "連鎖藥局",
  independent: "獨立藥局",
  clinic: "診所",
}

export function listCustomers(signal?: AbortSignal) {
  return request<Customer[]>("/api/customers", { signal })
}

export function getCustomer(id: string, signal?: AbortSignal) {
  return request<Customer>(`/api/customers/${encodeURIComponent(id)}`, { signal })
}
