import { useEffect, useRef } from "react"
import { LoaderCircle, RefreshCw } from "@/components/icons"
import {
  reportLoadedTime,
  reportRefreshDue,
  type RefreshSeconds,
} from "@/lib/report-refresh"

export function ReportRefreshControls({
  seconds,
  busy,
  loadedAt,
  asOf,
  onChange,
  onRefresh,
}: {
  seconds: RefreshSeconds
  busy: boolean
  loadedAt: string | null
  asOf?: string
  onChange: (seconds: RefreshSeconds) => void
  onRefresh: () => void
}) {
  const fullLoadedTime = reportLoadedTime(loadedAt)
  const loadedTime = loadedAt && Number.isFinite(Date.parse(loadedAt))
    ? new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(loadedAt))
    : fullLoadedTime
  const current = useRef({ busy, onRefresh })
  const lastAttempt = useRef(0)
  useEffect(() => {
    current.current = { busy, onRefresh }
    if (busy || !lastAttempt.current) lastAttempt.current = Date.now()
  }, [busy, onRefresh])
  useEffect(() => {
    if (!seconds) return
    const check = () => {
      if (
        reportRefreshDue(
          seconds,
          lastAttempt.current,
          Date.now(),
          document.visibilityState === "visible",
          navigator.onLine,
          current.current.busy
        )
      ) {
        lastAttempt.current = Date.now()
        current.current.onRefresh()
      }
    }
    const timer = window.setInterval(check, 1000)
    document.addEventListener("visibilitychange", check)
    window.addEventListener("online", check)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", check)
      window.removeEventListener("online", check)
    }
  }, [seconds])
  return (
    <div
      className="mt-3 flex min-w-0 flex-wrap items-center gap-2 border-t pt-3"
      aria-label="資料更新"
    >
      <button
        type="button"
        className="flex min-h-10 items-center gap-1.5 rounded-md border bg-background px-3 text-sm disabled:opacity-40"
        disabled={busy}
        onClick={onRefresh}
      >
        {busy ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw className="size-3.5" />
        )}{" "}
        {busy ? "正在刷新" : "刷新資料"}
      </button>
      <label className="flex min-w-0 items-center gap-2 text-sm">
        自動刷新
        <select
          className="h-10 min-w-0 rounded-md border bg-background px-2"
          aria-label="自動刷新間隔"
          value={seconds}
          onChange={(event) =>
            onChange(Number(event.target.value) as RefreshSeconds)
          }
        >
          <option value="0">關閉</option>
          <option value="60">每 1 分鐘</option>
          <option value="300">每 5 分鐘</option>
          <option value="900">每 15 分鐘</option>
        </select>
      </label>
      <p
        className="min-w-0 flex-[1_1_19rem] text-xs leading-relaxed text-muted-foreground"
        role="status"
        title={`${fullLoadedTime}（台北時間）。${seconds > 0 ? "自動刷新僅在本頁開啟、前景且連線時執行。" : ""}`}
      >
        資料截至 {asOf ?? "載入中"} · 更新 {loadedTime}
      </p>
    </div>
  )
}
