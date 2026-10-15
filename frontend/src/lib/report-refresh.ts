export type RefreshSeconds = 0 | 60 | 300 | 900

export function reportRefreshDue(
  seconds: RefreshSeconds,
  lastAttempt: number,
  now: number,
  visible: boolean,
  online: boolean,
  busy: boolean
): boolean {
  return (
    seconds > 0 &&
    visible &&
    online &&
    !busy &&
    now - lastAttempt >= seconds * 1000
  )
}

export function reportLoadedTime(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "尚未成功載入"
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value))
}
