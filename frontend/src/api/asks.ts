import type { Attachment } from "@/api/attachments"
import { jsonBody, request, upload } from "@/api/client"

export type AskKind = "data" | "knowledge"
export type AskStatus = "queued" | "running" | "answered" | "no_evidence" | "not_converged" | "failed"

export type TraceItem = {
  round: number
  // attachment：先看懂提問附的檔案（AI 寫的說明放在 decision）
  step: "attachment" | "sql" | "search" | "rewrite" | "web" | "answer" | "stop"
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
  // 數字查詢的答案或查詢結果裡提到、而且是登入者負責的客戶，可以一鍵排進今日路線；知識查詢或沒有就是 []
  customers: { id: string; name: string }[]
  // 提問附的照片或 PDF
  attachment: Attachment | null
}

export const isFinished = (ask: Ask) => ask.status !== "queued" && ask.status !== "running"

/** 提問。附了檔案（拍產品盒、仿單、競品海報）就用 multipart 上傳 */
export function createAsk(kind: AskKind, question: string, file?: File) {
  if (!file) return request<Ask>("/api/asks", jsonBody("POST", { kind, question }))
  const form = new FormData()
  form.append("kind", kind)
  form.append("question", question)
  form.append("file", file, file.name)
  return upload<Ask>("/api/asks", form)
}

export function getAsk(id: string, signal?: AbortSignal) {
  return request<Ask>(`/api/asks/${id}`, { signal })
}

export function escalateAsk(id: string) {
  return request<Ask>(`/api/asks/${id}/escalate`, { method: "POST" })
}
