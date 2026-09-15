import { jsonBody, request } from "@/api/client"

export type AskKind = "data" | "knowledge"
export type AskStatus = "queued" | "running" | "answered" | "no_evidence" | "not_converged" | "failed"

export type TraceItem = {
  round: number
  step: "sql" | "search" | "rewrite" | "web" | "answer" | "stop"
  sql: string | null
  search_query: string | null
  row_count: number | null
  decision: string
}

// 知識題的出處：kind 是 kb 的是內部文件段落，web 的是網頁（有網址）
export type Source = {
  kind?: "kb" | "web"
  index?: number
  chunk_id?: number
  source_name: string
  doc_title: string
  section: string
  content: string
  url?: string
}

// 數字題的依據是最後一次查詢的結果表；知識題的依據是引用的文件段落（route 標示答案是從公司資料還是網路來的）
export type AskEvidence = {
  sql?: string
  columns?: string[]
  rows?: unknown[][]
  blocked_reason?: string
  route?: "kb" | "web"
  sources?: Source[]
  // 知識題刻意不上網的原因：medical（用藥題，不給轉主管）、internal（只有公司內部才有答案）
  reason?: "medical" | "internal" | null
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
