import type { PromotionItem } from "@/api/promotions"
import type { FieldKey, IntentItem, VisitFields } from "@/api/visits"
import { formatDate, formatMoney } from "@/lib/format"
import { packDeal } from "@/lib/quote"

export const FIELD_ORDER: FieldKey[] = ["competitor", "complaint", "intent", "commitment", "follow_up_date"]

export const FIELD_LABEL: Record<FieldKey, string> = {
  competitor: "競品",
  complaint: "抱怨",
  intent: "意向",
  commitment: "承諾",
  follow_up_date: "追蹤",
}

/** 意向的一項：促銷的口寫「Premium眼藥水(小口) × 1 口（買 22 送 1，NT$5,500）」，其他照口述講法 */
export function intentLine(item: IntentItem, pack?: PromotionItem) {
  if (item.promo_code && pack && item.qty) {
    return `${pack.name} × ${item.qty} 口（${packDeal(pack)}，${formatMoney(pack.deal_price * item.qty)}）`
  }
  return `${item.product_text} × ${item.qty ?? "？"}${item.unit ?? ""}`
}

/**
 * 欄位在確認頁上的一行摘要；沒提到的欄位回傳 null（畫面上顯示「沒提到」）。
 * packs 是促銷的口（照編號查，不管哪一期），意向裡的口才寫得出搭贈與金額
 */
export function summarize(key: FieldKey, fields: VisitFields, packs: Record<string, PromotionItem> = {}): string | null {
  switch (key) {
    case "competitor":
      return fields.competitor?.map((c) => (c.detail ? `${c.name}（${c.detail}）` : c.name)).join("、") || null
    case "complaint":
      return fields.complaint
    case "intent":
      return fields.intent?.map((i) => intentLine(i, i.promo_code ? packs[i.promo_code] : undefined)).join("、") || null
    case "commitment": {
      const c = fields.commitment
      if (!c) return null
      return `${c.by === "us" ? "我方" : "客戶"}：${c.text}${c.due ? `（${formatDate(c.due)} 前）` : ""}`
    }
    case "follow_up_date":
      return fields.follow_up_date ? formatDate(fields.follow_up_date) : null
  }
}
