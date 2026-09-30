import { jsonBody, request } from "@/api/client"

export type OaStatus = "draft" | "pending" | "returned" | "rejected" | "approved"

// trip：出差單；discount：優惠（報價折扣）；contract：合約（連鎖續約）
export type OaKind = "trip" | "discount" | "contract"

// 模型對優惠、合約申請的估計，簽核頁給主管參考。reasons 是照門檻列的事實，alert 的那一行標紅
export type OaModel = {
  probability: number | null
  auto_approved: boolean
  reasons: { text: string; alert: boolean }[]
}

export type OaFormItem = {
  id: number
  form_no: string
  kind: OaKind
  kind_label: string
  // 一句話摘要：「折扣 6%，報價 NT$ 48,200」「續約 12 個月，費率不變」
  summary: string
  status: OaStatus
  applicant_name: string
  customer_name: string
  // 出差單是拜訪日；優惠與合約沒有拜訪，看 request_date（送單當下的系統日）
  trip_date: string | null
  request_date: string | null
  submitted_at: string
  approver_name: string | null
  // 出差單不經過模型
  model: OaModel | null
}

// 優惠申請單的內容。假資料的歷史單沒有報價（quote_no 是 null）
export type DiscountPayload = {
  quote_no: string | null
  discount_pct: number
  list_amount: number
  amount: number
  cost: number
  reason: string
}

// 合約申請單的內容。新費率只記在申請單上
export type ContractPayload = {
  term_months: number
  listing_fee_rate: { from: number; to: number }
  channel_reward_rate: { from: number; to: number }
  old_end_date: string | null
  new_end_date: string
  reason: string
}

export type OaList = {
  items: OaFormItem[]
  counts: Partial<Record<OaStatus, number>>
}

export type OaFormDetail = {
  id: number
  form_no: string
  kind: OaKind
  kind_label: string
  flow_name: string
  summary: string
  status: OaStatus
  visit_id: string | null
  applicant_name: string
  applicant_title: string
  applicant_id: string
  unit_name: string
  trip_date: string | null
  request_date: string | null
  customer_id: string
  customer_name: string
  purpose: string
  // 出差單沒有；優惠與合約依 kind 是下面兩種之一
  payload: DiscountPayload | ContractPayload | null
  model: OaModel | null
  submitted_at: string
  steps: {
    step_no: number
    role_label: string
    title: string
    name: string
    status: "waiting" | "pending" | "done"
    acted_at: string | null
  }[]
  comments: { id: number; author_name: string; body: string; created_at: string }[]
  attachments: { id: number; filename: string; uploaded_by: string; created_at: string }[]
  activity: {
    id: number
    action: string
    detail: string
    actor_name: string
    actor_unit: string
    created_at: string
  }[]
  can_decide: boolean
}

export function listMyForms(status?: OaStatus, signal?: AbortSignal) {
  return request<OaList>(`/api/oa/forms${status ? `?status=${status}` : ""}`, { signal })
}

export function listOaInbox(signal?: AbortSignal) {
  return request<OaList>("/api/oa/inbox", { signal })
}

/** 模型有把握、由系統核准的單（主管看自己底下的，IT 看全公司），給主管事後查 */
export function listAutoApproved(signal?: AbortSignal) {
  return request<{ items: OaFormItem[] }>("/api/oa/auto-approved", { signal })
}

export function getOaForm(id: number, signal?: AbortSignal) {
  return request<OaFormDetail>(`/api/oa/forms/${id}`, { signal })
}

/**
 * 簽核。stepNo 是畫面上顯示、正在等簽的那一關：後端發現現在等簽的不是這一關（別人剛簽過、或自己連點了兩次）就回 409，
 * 不會往下多簽一關
 */
export function decideOaForm(id: number, action: "approve" | "reject" | "return", comment?: string, stepNo?: number) {
  return request<OaFormDetail>(
    `/api/oa/forms/${id}/decide`,
    jsonBody("POST", { action, comment: comment || null, step_no: stepNo ?? null })
  )
}
