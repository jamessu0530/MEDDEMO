/** 2026-10-24 → 10/24 */
export function formatDate(iso: string) {
  const [, month, day] = iso.split("-")
  return `${Number(month)}/${Number(day)}`
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
