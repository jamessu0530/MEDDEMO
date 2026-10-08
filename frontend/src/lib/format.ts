/** 2026-10-24 → 10/24 */
export function formatDate(iso: string) {
  const [, month, day] = iso.split("-")
  return `${Number(month)}/${Number(day)}`
}

const WEEKDAYS = "日一二三四五六"

/** 2026-10-01 → 10/1（三），首頁橫幅用。用當地時間的午夜算星期，免得時區把日期推到前一天 */
export function formatDayLabel(iso: string) {
  const weekday = WEEKDAYS[new Date(`${iso}T00:00:00`).getDay()]
  return `${formatDate(iso)}（${weekday}）`
}

/** 2026-09-15T06:05:00Z → 9/15 14:05（手機的時區），列表上看得出是哪天的幾點 */
export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

/** 秒數 → 00:37 */
export function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
}

/** 12240 → NT$12,240；報價、待處理事項的金額都到元，不留小數 */
export function formatMoney(amount: number) {
  return `NT$${Math.round(amount).toLocaleString("zh-TW")}`
}

/** 2026-09-15T06:05:00Z → 9/15 14:05，固定用台北時間（不看手機的時區），圖鑑上「第一次騎」用 */
export function formatTaipeiDateTime(iso: string) {
  return new Date(iso).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
}

/** 962.5 → NT$962.5；促銷的平均單價照 CYH 上的寫法，留到小數兩位 */
export function formatUnitPrice(amount: number) {
  return `NT$${amount.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}`
}
