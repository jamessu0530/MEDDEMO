import { request } from "@/api/client"
import type { Customer } from "@/api/customers"

// 第一週的一件事：to 是 App 裡的路徑，doc 是一份內部文件的檔名，最多一個有值。
// 兩個都是 null 的事沒有連結（在新人頁本身就做得完，或文件不在索引裡），照樣能打勾
export type FirstWeekTask = { id: string; text: string; to: string | null; doc: string | null }

export type FirstWeekDay = { day: number; title: string; tasks: FirstWeekTask[] }

// 產品線裡同一區近 90 天進貨金額最高的品項；unit_price 是建議售價，aliases 是業務口語的叫法
export type TopProduct = { sku: string; name: string; unit_price: number; aliases: string[] }

/*
 * 新人第一週整頁的資料。「你是誰、賣什麼」來自模擬 SAP 的人員主檔，其他數字後端現查；
 * days 與 documents 是設定檔裡人寫的內容（backend/app/resources/first_week.json），不是 AI 生成的。
 */
export type FirstWeek = {
  is_newcomer: boolean
  // 到職第幾天，到職日當天是 1；自建與第三方登入的帳號沒有人員主檔，是 null
  day_no: number | null
  employee: {
    employee_no: string | null
    hire_date: string | null
    region: string
    manager_name: string | null
    cities: string[]
    // 自建帳號看的是這位示範業務的資料；公司帳號是 null
    proxy_of: string | null
  }
  customers: { total: number; by_type: Record<Customer["type"], number>; by_grade: Record<string, number> }
  product_lines: { category: string; sku_count: number; top: TopProduct[] }[]
  // 進行中的那一期促銷；沒有就是 null
  promotion: { name: string; item_count: number } | null
  key_customers: {
    id: string
    name: string
    type: Customer["type"]
    grade: string
    city: string
    amount_last_90d: number
  }[]
  days: FirstWeekDay[]
  documents: { source_name: string; title: string }[]
}

// 首頁的入口卡用。task_ids 是第一週每件事的 id：勾選記在手機裡（lib/first-week.ts），拿它算完成幾件
export type FirstWeekStatus = { is_newcomer: boolean; day_no: number | null; task_ids: string[] }

// 一份內部文件：標題加各小節的原文
export type InternalDocument = {
  source_name: string
  title: string
  sections: { section: string; content: string }[]
}

export function getFirstWeek(signal?: AbortSignal) {
  return request<FirstWeek>("/api/first-week", { signal })
}

/** 主管與 IT 問了也不會是錯誤，回 is_newcomer: false */
export function getFirstWeekStatus(signal?: AbortSignal) {
  return request<FirstWeekStatus>("/api/first-week/status", { signal })
}

/** sourceName 是 data/documents/ 的檔名，例如 09-拜訪紀錄.md */
export function getDocument(sourceName: string, signal?: AbortSignal) {
  return request<InternalDocument>(`/api/documents/${encodeURIComponent(sourceName)}`, { signal })
}
