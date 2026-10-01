import type { MemoryCategory } from "@/api/memory"

export const CATEGORY_LABEL: Record<MemoryCategory, string> = {
  complaint: "客訴",
  competitor: "競品",
  todo: "待辦",
  decision: "決議",
  experience: "經驗",
}

export const CATEGORIES = Object.keys(CATEGORY_LABEL) as MemoryCategory[]

function days(fromIso: string, toIso: string) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000)
}

/** 待辦的到期日怎麼寫：逾期幾天、今天、明天，其他寫日期。today 是手機上的 YYYY-MM-DD */
export function dueText(due: string, today: string): { text: string; overdue: boolean } {
  const left = days(today, due)
  if (left < 0) return { text: `逾期 ${-left} 天`, overdue: true }
  if (left === 0) return { text: "今天到期", overdue: false }
  if (left === 1) return { text: "明天到期", overdue: false }
  const [, month, day] = due.split("-")
  return { text: `${Number(month)}/${Number(day)} 到期`, overdue: false }
}

/** 手機上的今天（不是 UTC 的今天：台灣早上 8 點前 UTC 還是前一天） */
export function localToday(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
