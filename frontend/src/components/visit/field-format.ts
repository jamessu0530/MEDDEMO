import type { FieldKey, VisitFields } from "@/api/visits"
import { formatDate } from "@/lib/format"

export const FIELD_ORDER: FieldKey[] = ["competitor", "complaint", "intent", "commitment", "follow_up_date"]

export const FIELD_LABEL: Record<FieldKey, string> = {
  competitor: "競品",
  complaint: "抱怨",
  intent: "意向",
  commitment: "承諾",
  follow_up_date: "追蹤",
}

/** 欄位在確認頁上的一行摘要；沒提到的欄位回傳 null（畫面上顯示「沒提到」） */
export function summarize(key: FieldKey, fields: VisitFields): string | null {
  switch (key) {
    case "competitor":
      return fields.competitor?.map((c) => (c.detail ? `${c.name}（${c.detail}）` : c.name)).join("、") || null
    case "complaint":
      return fields.complaint
    case "intent":
      return fields.intent?.map((i) => `${i.product_text} × ${i.qty ?? "？"}${i.unit ?? ""}`).join("、") || null
    case "commitment": {
      const c = fields.commitment
      if (!c) return null
      return `${c.by === "us" ? "我方" : "客戶"}：${c.text}${c.due ? `（${formatDate(c.due)} 前）` : ""}`
    }
    case "follow_up_date":
      return fields.follow_up_date ? formatDate(fields.follow_up_date) : null
  }
}
