import { jsonBody, request } from "@/api/client"

// 五個欄位的格式與 backend/app/schemas/visit_fields.schema.json 一致
export type Competitor = { name: string; detail: string | null }
export type IntentItem = { product_text: string; sku: string | null; qty: number | null; unit: string | null }
export type Commitment = { by: "us" | "customer"; text: string; due: string | null }
export type VisitFields = {
  competitor: Competitor[] | null
  complaint: string | null
  intent: IntentItem[] | null
  commitment: Commitment | null
  follow_up_date: string | null
}
export type FieldKey = keyof VisitFields

export type WritebackTarget = "crm" | "sap" | "oa"
export type WritebackItem = {
  target: WritebackTarget
  status: "pending" | "success" | "failed" | "skipped"
  error_message: string | null
  attempt: number
}

// 確認送出時這次提到競品或客訴，後端算這家的風險分並通報主管
export type RiskNotice = {
  score: number
  max: number
  items: string[]
  reason: string
  manager_name: string
}

export type Visit = {
  id: string
  customer_id: string
  customer_name: string
  status: "processing" | "failed" | "draft" | "confirmed" | "synced"
  stage: "transcribing" | "extracting" | "done" | "failed" | null
  error_message: string | null
  visited_at: string
  transcript: string
  fields: VisitFields
  sources: Partial<Record<FieldKey, string>>
  unsourced: FieldKey[]
  writeback: WritebackItem[]
  reminder: { due_date: string; note: string } | null
  // 這次提到、而這家客戶以前確認過的拜訪從沒提過的競品，畫面上標「首次」
  first_competitors: string[]
  // 只有確認送出、而且這次提到競品或客訴時才有
  risk_notice: RiskNotice | null
}

export function uploadAudio(customerId: string, audio: Blob, filename: string, clientRef: string) {
  const form = new FormData()
  form.append("customer_id", customerId)
  form.append("client_ref", clientRef)
  form.append("file", audio, filename)
  return request<Visit>("/api/visits/audio", { method: "POST", body: form })
}

export function getVisit(id: string, signal?: AbortSignal) {
  return request<Visit>(`/api/visits/${id}`, { signal })
}

export function submitTranscript(id: string, text: string) {
  return request<Visit>(`/api/visits/${id}/transcript`, jsonBody("POST", { text }))
}

export function reprocessVisit(id: string) {
  return request<Visit>(`/api/visits/${id}/reprocess`, { method: "POST" })
}

export function updateFields(id: string, fields: VisitFields) {
  return request<Visit>(`/api/visits/${id}/fields`, jsonBody("PUT", { fields }))
}

export function confirmVisit(id: string) {
  return request<Visit>(`/api/visits/${id}/confirm`, { method: "POST" })
}

export function retryWriteback(id: string, target: WritebackTarget) {
  return request<Visit>(`/api/visits/${id}/writeback/${target}/retry`, { method: "POST" })
}

export function discardVisit(id: string) {
  return request<void>(`/api/visits/${id}`, { method: "DELETE" })
}
