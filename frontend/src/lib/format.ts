/** 2026-10-24 → 10/24 */
export function formatDate(iso: string) {
  const [, month, day] = iso.split("-")
  return `${Number(month)}/${Number(day)}`
}

/** 秒數 → 00:37 */
export function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
}
