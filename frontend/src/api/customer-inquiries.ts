import type { AskKind, AskStatus } from "@/api/asks"
import { request } from "@/api/client"

export type InquiryRep = { id: string; name: string; region: string }
export type CustomerInquiry = {
  id: string
  rep: InquiryRep
  customers: { id: string; name: string }[]
  question: string
  kind: AskKind
  status: AskStatus
  created_at: string
}
export type TeamInquiries = {
  scope: string
  reps: InquiryRep[]
  items: CustomerInquiry[]
  total: number
}

export function getCustomerInquiries(
  query: URLSearchParams,
  signal?: AbortSignal
) {
  return request<TeamInquiries>(`/api/manager/inquiries?${query}`, { signal })
}
