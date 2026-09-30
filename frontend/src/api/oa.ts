import { jsonBody, request } from "@/api/client"

export type OaStatus = "draft" | "pending" | "returned" | "rejected" | "approved"

// trip：出差單；discount：優惠（報價折扣）；contract：合約（連鎖續約）
export type OaKind = "trip" | "discount" | "contract"

export type OaFormItem = {
  id: number
  form_no: string
  kind: OaKind
  kind_label: string
  status: OaStatus
  applicant_name: string
  customer_name: string
  trip_date: string
  submitted_at: string
  approver_name: string | null
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
  status: OaStatus
  visit_id: string
  applicant_name: string
  applicant_title: string
  applicant_id: string
  unit_name: string
  trip_date: string
  customer_name: string
  purpose: string
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

export function getOaForm(id: number, signal?: AbortSignal) {
  return request<OaFormDetail>(`/api/oa/forms/${id}`, { signal })
}

export function decideOaForm(id: number, action: "approve" | "reject" | "return", comment?: string) {
  return request<OaFormDetail>(`/api/oa/forms/${id}/decide`, jsonBody("POST", { action, comment: comment || null }))
}
