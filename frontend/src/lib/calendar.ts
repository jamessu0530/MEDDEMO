// 日曆與拜訪備忘的純計算（pages/calendar.tsx）：日期一律用 YYYY-MM-DD 字串，用 UTC 算星期，不經過時區

export const NOTE_KIND_LABEL = { bring: "要帶的", told: "講過的" } as const

const WEEKDAYS = "日一二三四五六"
const pad = (n: number) => String(n).padStart(2, "0")

function parts(date: string) {
  return date.split("-").map(Number)
}

/** 一個月的格子，從星期一開始；前後補 null 湊滿整週 */
export function monthGrid(month: string): (string | null)[] {
  const [year, mon] = parts(month)
  const days = new Date(Date.UTC(year, mon, 0)).getUTCDate()
  // getUTCDay 的星期日是 0，換成星期一是 0
  const lead = (new Date(Date.UTC(year, mon - 1, 1)).getUTCDay() + 6) % 7
  const cells: (string | null)[] = Array(lead).fill(null)
  for (let day = 1; day <= days; day++) cells.push(`${month}-${pad(day)}`)
  while (cells.length % 7) cells.push(null)
  return cells
}

/** 2026-12 往後一個月是 2027-01 */
export function shiftMonth(month: string, delta: number) {
  const [year, mon] = parts(month)
  const date = new Date(Date.UTC(year, mon - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`
}

/** 2026-10-30 → 10/30 */
export function noteDate(date: string) {
  const [, mon, day] = parts(date)
  return `${mon}/${day}`
}

/** 2026-10 → 2026 年 10 月 */
export function monthTitle(month: string) {
  const [year, mon] = parts(month)
  return `${year} 年 ${mon} 月`
}

/** 2026-10-30 → 10 月 30 日（星期五） */
export function dayTitle(date: string) {
  const [year, mon, day] = parts(date)
  return `${mon} 月 ${day} 日（星期${WEEKDAYS[new Date(Date.UTC(year, mon - 1, day)).getUTCDay()]}）`
}
