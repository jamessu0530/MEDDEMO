import { jsonBody, request } from "@/api/client"
import type { HabitDraft, HabitTarget } from "@/api/route"

export type RouteHabit = HabitDraft & {
  id: number
  // 給人看的一句話，後端依欄位產生
  text: string
  // ai：在首頁跟熊熊滾說的；prompt：拖完答應的；manual：自己新增的
  source: "ai" | "prompt" | "manual"
  active: boolean
  created_at: string
  // applied 套用中；skipped 今天不套用（原因在 skip_reason）；off 停用；other_day 不是今天
  today: "applied" | "skipped" | "off" | "other_day"
  skip_reason: string | null
}

export type HabitOption = { value: string; label: string }

export type HabitList = {
  // 今天星期幾，0 是星期一
  weekday: number
  habits: RouteHabit[]
  // 新增習慣能選的對象：自己的客戶、他們的連鎖體系、三種客戶類型、地區
  targets: Record<HabitTarget["by"], HabitOption[]>
}

export function listHabits(signal?: AbortSignal) {
  return request<HabitList>("/api/route-habits", { signal })
}

export function createHabit(habit: HabitDraft) {
  return request<RouteHabit>("/api/route-habits", jsonBody("POST", habit))
}

export function setHabitActive(id: number, active: boolean) {
  return request<RouteHabit>(`/api/route-habits/${id}`, jsonBody("PATCH", { active }))
}

export function deleteHabit(id: number) {
  return request<void>(`/api/route-habits/${id}`, { method: "DELETE" })
}
