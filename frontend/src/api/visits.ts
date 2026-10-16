import { jsonBody, request } from "@/api/client"

// 欄位的格式與 backend/app/schemas/visit_fields.schema.json 一致
export type Competitor = { name: string; detail: string | null }
// 備忘：bring 是下次要帶的東西，told 是跟客戶講過的促銷；date 只有要帶的才會有
export type NoteItem = { kind: "bring" | "told"; text: string; date: string | null }
// promo_code 有值時是促銷的某一口：qty 是口數、unit 是「口」
export type IntentItem = {
  product_text: string
  sku: string | null
  qty: number | null
  unit: string | null
  promo_code: string | null
}
export type Commitment = { by: "us" | "customer"; text: string; due: string | null }
export type VisitFields = {
  competitor: Competitor[] | null
  complaint: string | null
  intent: IntentItem[] | null
  commitment: Commitment | null
  follow_up_date: string | null
  notes: NoteItem[] | null
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

// 講了跟上次一樣、或跟上次比加減時，展開那一刻的快照（後端 services/repeat_order.py）
export type RepeatSnapshot = {
  said: string | null
  all: boolean
  except_skus: string[]
  except_names: string[]
  order: { order_no: string; date: string } | null
  quote: { quote_no: string; date: string } | null
  // 這家還沒訂過
  empty: boolean
  // 照上次抄了幾項（拿掉不要的之後）
  copied: number
  // promo_code 是這次抄成的口，不走促銷是 null
  changes: { sku: string; promo_code: string | null; text: string }[]
  relative: { sku: string; promo_code: string | null; last_qty: number; delta: number }[]
}

export type CustomerCandidate = { id: string; name: string; quote: string; match_kind: "exact" | "phonetic" }

export type Visit = {
  id: string
  customer_id: string
  customer_name: string
  status: "processing" | "failed" | "draft" | "confirmed" | "synced"
  stage: "transcribing" | "extracting" | "done" | "failed" | null
  error_message: string | null
  visited_at: string
  transcript: string
  recording_language?: RecordingLanguage
  fields: VisitFields
  sources: Partial<Record<FieldKey, string>>
  unsourced: FieldKey[]
  writeback: WritebackItem[]
  reminder: { due_date: string; note: string } | null
  // 這次提到、而這家客戶以前確認過的拜訪從沒提過的競品，畫面上標「首次」
  first_competitors: string[]
  // 只有確認送出、而且這次提到競品或客訴時才有
  risk_notice: RiskNotice | null
  oa_form_id: number | null
  // 沒講跟上次一樣、也沒講跟上次比的加減是 null
  repeat_last: RepeatSnapshot | null
  customer_candidates?: CustomerCandidate[]
}

// 新錄音一律 auto；明確語言保留給舊版離線錄音與歷史紀錄。
export type RecordingLanguage = "auto" | "zh-TW" | "nan-TW" | "en" | "ja" | "id" | "vi" | "th"
export type LiveRecordingLanguage = Exclude<RecordingLanguage, "auto" | "nan-TW">
export type RecordingOptions = { taiwanese_available: boolean; taiwanese_max_seconds: number }

export function getRecordingOptions(signal?: AbortSignal) {
  return request<RecordingOptions>("/api/visits/audio/options", { signal })
}

export function uploadAudio(customerId: string, audio: Blob, filename: string, clientRef: string, language: RecordingLanguage = "zh-TW") {
  const form = new FormData()
  form.append("customer_id", customerId)
  form.append("client_ref", clientRef)
  form.append("language", language)
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

export function updateVisitCustomer(id: string, customerId: string) {
  return request<Visit>(`/api/visits/${id}/customer`, jsonBody("PUT", { customer_id: customerId }))
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
