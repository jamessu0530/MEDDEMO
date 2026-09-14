import { jsonBody, request } from "@/api/client"

export type AskKind = "data" | "knowledge"
export type AskStatus = "queued" | "running" | "answered" | "no_evidence" | "not_converged" | "failed"

export type TraceItem = {
  round: number
  step: "sql" | "search" | "rewrite" | "answer" | "stop"
  sql: string | null
  search_query: string | null
  row_count: number | null
  decision: string
}

export type Source = {
  chunk_id: number
  source_name: string
  doc_title: string
  section: string
  content: string
}

// 數字題的依據是最後一次查詢的結果表；知識題的依據是引用的文件段落
export type AskEvidence = {
  sql?: string
  columns?: string[]
  rows?: unknown[][]
  blocked_reason?: string
  sources?: Source[]
}

export type Ask = {
  id: string
  kind: AskKind
  question: string
  status: AskStatus
  answer: string | null
  evidence: AskEvidence | null
  error_message: string | null
  trace: TraceItem[]
  escalation_id: number | null
}

export const isFinished = (ask: Ask) => ask.status !== "queued" && ask.status !== "running"

export function createAsk(kind: AskKind, question: string) {
  return request<Ask>("/api/asks", jsonBody("POST", { kind, question }))
}

export function getAsk(id: string, signal?: AbortSignal) {
  return request<Ask>(`/api/asks/${id}`, { signal })
}

export function escalateAsk(id: string) {
  return request<Ask>(`/api/asks/${id}/escalate`, { method: "POST" })
}
