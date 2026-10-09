import { jsonBody, request } from "@/api/client"

// 拜訪備忘：bring 是下次要帶的東西，told 是跟客戶講過的促銷（docs/superpowers/specs/2026-10-07-calendar-notes-design.md），
// competitor 是確認拜訪時業務講到的競品（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md），不能手寫
export type NoteKind = "bring" | "told" | "competitor"
export type WritableNoteKind = Exclude<NoteKind, "competitor">

export type Note = {
  id: number
  customer_id: string
  customer_name: string
  kind: NoteKind
  text: string
  // 放在日曆的哪一天；要帶的沒講日期是 null，講過的一定有
  on_date: string | null
  // 錄音來的才有；手寫的是 null
  visit_id: string | null
  created_at: string
}

export type CalendarDay = {
  date: string
  visits: { visit_id: string; customer_id: string; customer_name: string }[]
  notes: Note[]
}

export type CalendarMonth = {
  month: string
  // 系統日：標「今天」用，跟首頁同一天
  today: string
  // 只列有拜訪或有備忘的日子
  days: CalendarDay[]
}

/** 下次去這家要記得的：最近一次有備忘的拜訪記下的，加上那之後手寫的；要帶的在前 */
export function getNextNotes(customerId: string, signal?: AbortSignal) {
  return request<{ next: Note[] }>(`/api/customers/${encodeURIComponent(customerId)}/notes`, { signal })
}

/** 手寫一則；講過的沒給日期，後端用今天（系統日） */
export function createNote(customerId: string, note: { kind: WritableNoteKind; text: string; on_date: string | null }) {
  return request<Note>(`/api/customers/${encodeURIComponent(customerId)}/notes`, jsonBody("POST", note))
}

export function updateNote(id: number, patch: Partial<Pick<Note, "text" | "on_date"> & { kind: WritableNoteKind }>) {
  return request<Note>(`/api/notes/${id}`, jsonBody("PATCH", patch))
}

export function deleteNote(id: number) {
  return request<void>(`/api/notes/${id}`, { method: "DELETE" })
}

/** month 沒給就是系統日那個月 */
export function getCalendar(month: string | null, signal?: AbortSignal) {
  return request<CalendarMonth>(`/api/calendar${month ? `?month=${month}` : ""}`, { signal })
}

// 首頁點站彈出的小卡：進門前三分鐘與下次去要記得，一次拿齊
export type Brief = { highlights: string[]; notes: Note[] }

export function getBrief(customerId: string, signal?: AbortSignal) {
  return request<Brief>(`/api/customers/${encodeURIComponent(customerId)}/brief`, { signal })
}
