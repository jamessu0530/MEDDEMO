import { jsonBody, request } from "@/api/client"

// 查不到答案時轉給主管的提問（FR-8.4 延伸）。system_answer 是系統當時的回覆，主管回覆前看得到業務卡在哪裡
export type Escalation = {
  id: number
  ask_id: string
  kind: "data" | "knowledge"
  question: string
  system_answer: string | null
  status: "open" | "answered"
  answer: string | null
  answered_by: string | null
  answered_at: string | null
  seen_at: string | null
  created_at: string
}

export function listEscalations(status?: Escalation["status"], signal?: AbortSignal) {
  return request<Escalation[]>(`/api/escalations${status ? `?status=${status}` : ""}`, { signal })
}

export function getUnseenCount(signal?: AbortSignal) {
  return request<{ count: number }>("/api/escalations/unseen", { signal })
}

/** 回覆的人是誰由後端看 token 認，不必送 manager_id */
export function replyEscalation(id: number, answer: string) {
  return request<Escalation>(`/api/escalations/${id}/reply`, jsonBody("POST", { answer }))
}

export function markSeen(id: number) {
  return request<Escalation>(`/api/escalations/${id}/seen`, { method: "POST" })
}
