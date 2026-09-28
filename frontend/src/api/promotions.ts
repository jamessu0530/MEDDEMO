import { request } from "@/api/client"

// 一「口」是促銷的一個購買單位：買 buy_qty 個、同品送 free_qty 個，付 deal_price。
// 平均每個（unit_deal_price）與折扣率由後端的 View 算，頁面跟問答查到的數字一樣
export type PromotionItem = {
  code: string
  group_name: string
  name: string
  sku: string
  spec: string
  unit: string
  deal: string
  buy_qty: number
  free_qty: number
  deal_price: number
  unit_deal_price: number
  list_price: number
  ship_price: number
  discount_rate: number
}

export type Promotion = {
  name: string
  type: string
  department: string
  start_date: string
  end_date: string
  status: "未開始" | "進行中" | "已結束"
  // PM 提醒原文：滿額贈這類看整張訂單的規則只寫在這裡
  pm_note: string
  items: PromotionItem[]
}

/** 每一期都一次拿回來，新的一期在前 */
export function listPromotions(signal?: AbortSignal) {
  return request<Promotion[]>("/api/promotions", { signal })
}
